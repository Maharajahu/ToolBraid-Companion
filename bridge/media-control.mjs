import { execFile } from 'node:child_process';
import { randomBytes as nodeRandomBytes } from 'node:crypto';
import { mkdir, rm, stat as nodeStat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createMediaJobs } from '../local-agent/media-jobs.mjs';
import { LocalBridgeError } from './common.mjs';

const OPERATIONS = Object.freeze(['trim', 'concat', 'transcode', 'burn-subtitles', 'thumbnail']);
const OPERATION_SET = new Set(OPERATIONS);
const CODECS = new Set(['h264', 'h265', 'vp9', 'av1']);
const VIDEO_FORMATS = new Set(['mp4', 'mov', 'mkv', 'webm']);
const IMAGE_FORMATS = new Set(['png', 'jpg', 'jpeg', 'webp']);
const TERMINAL_STATUSES = new Set(['complete', 'failed', 'cancelled']);
const GRANT_ID = /^[a-f0-9]{64}$/;
const MAX_INPUTS = 32;
const MAX_DURATION_SECONDS = 6 * 60 * 60;
const MAX_OUTPUT_BYTES = 20 * 1024 * 1024 * 1024;
const MAX_TIMEOUT_MS = 20 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_ACTIVE_JOBS = 4;
const DEFAULT_MAX_RETAINED_JOBS = 128;

function fail(code, message) {
  throw new LocalBridgeError(code, message);
}

function plain(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireOwnerId(ownerId) {
  if (typeof ownerId !== 'string' || ownerId.length < 16 || ownerId.length > 128) {
    fail('MEDIA_JOB_OWNER_INVALID', 'An internal media-job owner is required.');
  }
  return ownerId;
}

function boundedNumber(value, name, min, max, required = false) {
  if (value === undefined && !required) return undefined;
  if (!Number.isFinite(value) || value < min || value > max) {
    fail('MEDIA_JOB_BOUNDS', `${name} is outside its allowed bounds.`);
  }
  return value;
}

function exactKeys(value, allowed, code, message) {
  if (!plain(value) || Object.keys(value).some((key) => !allowed.has(key))) fail(code, message);
}

function normalizeExpected(value, operation) {
  exactKeys(
    value,
    new Set(['maxBytes', 'durationSeconds', 'format']),
    'MEDIA_JOB_OUTPUT_METADATA',
    'Expected output metadata is invalid.',
  );
  const maxBytes = boundedNumber(value.maxBytes, 'expectedOutput.maxBytes', 1, MAX_OUTPUT_BYTES, true);
  const durationSeconds = boundedNumber(
    value.durationSeconds,
    'expectedOutput.durationSeconds',
    0,
    MAX_DURATION_SECONDS,
  );
  const fallback = operation === 'thumbnail' ? 'png' : 'mp4';
  const format = value.format === undefined ? fallback : String(value.format).toLowerCase();
  const formats = operation === 'thumbnail' ? IMAGE_FORMATS : VIDEO_FORMATS;
  if (!formats.has(format)) fail('MEDIA_JOB_FORMAT', 'Output format is not allowlisted.');
  return Object.freeze({ maxBytes, durationSeconds, format });
}

function normalizeCreate(input) {
  if (!plain(input) || !OPERATION_SET.has(input.operation)) {
    fail('MEDIA_JOB_OPERATION', 'Operation is not allowlisted.');
  }
  const operationFields = {
    trim: ['startSeconds', 'durationSeconds'],
    concat: [],
    transcode: ['codec'],
    'burn-subtitles': [],
    thumbnail: ['atSeconds'],
  }[input.operation];
  exactKeys(
    input,
    new Set(['operation', 'inputGrantIds', 'expectedOutput', 'timeoutMs', ...operationFields]),
    'MEDIA_JOB_ARGUMENTS_INVALID',
    'Media job arguments contain an unknown or invalid field.',
  );
  if (!Array.isArray(input.inputGrantIds)) fail('MEDIA_JOB_INPUTS', 'Media job input grants are invalid.');
  const required = input.operation === 'concat' ? 2 : input.operation === 'burn-subtitles' ? 2 : 1;
  if (input.inputGrantIds.length < required || input.inputGrantIds.length > MAX_INPUTS
    || (input.operation !== 'concat' && input.inputGrantIds.length !== required)) {
    fail('MEDIA_JOB_INPUTS', 'Operation received an invalid bounded input count.');
  }
  const inputGrants = input.inputGrantIds.map((grantId) => {
    if (typeof grantId !== 'string' || !GRANT_ID.test(grantId)) {
      fail('MEDIA_JOB_GRANT', 'An input file grant id is invalid.');
    }
    return grantId;
  });
  if (new Set(inputGrants).size !== inputGrants.length) {
    fail('MEDIA_JOB_GRANT', 'Every input requires a distinct single-use file grant.');
  }
  const timeoutMs = boundedNumber(
    input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    'timeoutMs',
    100,
    MAX_TIMEOUT_MS,
    true,
  );
  const normalized = {
    operation: input.operation,
    inputGrants: Object.freeze(inputGrants),
    expectedOutput: normalizeExpected(input.expectedOutput, input.operation),
    timeoutMs,
  };
  if (input.operation === 'trim') {
    normalized.startSeconds = boundedNumber(input.startSeconds, 'startSeconds', 0, MAX_DURATION_SECONDS, true);
    normalized.durationSeconds = boundedNumber(input.durationSeconds, 'durationSeconds', 0.001, MAX_DURATION_SECONDS, true);
  } else if (input.operation === 'transcode') {
    normalized.codec = input.codec ?? 'h264';
    if (!CODECS.has(normalized.codec)) fail('MEDIA_JOB_CODEC', 'Codec is not allowlisted.');
  } else if (input.operation === 'thumbnail') {
    normalized.atSeconds = boundedNumber(input.atSeconds, 'atSeconds', 0, MAX_DURATION_SECONDS, true);
  }
  return Object.freeze(normalized);
}

function normalizeLookup(input) {
  exactKeys(
    input,
    new Set(['jobId']),
    'MEDIA_JOB_ARGUMENTS_INVALID',
    'Media job lookup accepts exactly one jobId.',
  );
  if (typeof input.jobId !== 'string' || !/^media-[a-f0-9]{32}$/.test(input.jobId)) {
    fail('MEDIA_JOB_ID_INVALID', 'Media job id is invalid.');
  }
  return input.jobId;
}

function defaultAdapter(ffmpegPath) {
  return Object.freeze({
    run(args, { signal, timeoutMs }) {
      return new Promise((resolve, reject) => {
        execFile(ffmpegPath, args, {
          shell: false,
          windowsHide: true,
          timeout: timeoutMs,
          signal,
          maxBuffer: 1024 * 1024,
        }, (error, stdout, stderr) => {
          if (error) reject(error);
          else resolve({ stdout, stderr });
        });
      });
    },
  });
}

function publicGrant(value) {
  if (!plain(value) || typeof value.grantId !== 'string' || !GRANT_ID.test(value.grantId)
    || typeof value.basename !== 'string' || value.basename.length < 1 || value.basename.length > 255
    || /[\\/]/.test(value.basename) || !Number.isFinite(value.size) || value.size < 0
    || typeof value.mime !== 'string' || value.mime.length > 128
    || !Number.isFinite(value.expiresAt)) {
    fail('MEDIA_JOB_OUTPUT_GRANT_INVALID', 'The output file grant could not be created.');
  }
  return Object.freeze({
    grantId: value.grantId,
    basename: value.basename,
    size: value.size,
    mime: value.mime,
    expiresAt: value.expiresAt,
  });
}

function publicError(error, cancelled) {
  if (cancelled || error?.code === 'MEDIA_JOB_CANCELLED') {
    return Object.freeze({ code: 'MEDIA_JOB_CANCELLED', message: 'Media job was cancelled.' });
  }
  const known = new Set([
    'MEDIA_JOB_BOUNDS', 'MEDIA_JOB_CODEC', 'MEDIA_JOB_FORMAT', 'MEDIA_JOB_GRANT',
    'MEDIA_JOB_INPUTS', 'MEDIA_JOB_OPERATION', 'MEDIA_JOB_OUTPUT_INVALID',
    'MEDIA_JOB_OUTPUT_METADATA', 'MEDIA_JOB_TIMEOUT',
  ]);
  const code = known.has(error?.code) ? error.code : 'MEDIA_JOB_FAILED';
  const messages = {
    MEDIA_JOB_TIMEOUT: 'Media job timed out.',
    MEDIA_JOB_OUTPUT_INVALID: 'Output metadata validation failed.',
  };
  return Object.freeze({ code, message: messages[code] ?? 'Media job failed.' });
}

function publicState(record) {
  return Object.freeze({
    jobId: record.jobId,
    status: record.status,
    operation: record.operation,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    output: record.output,
    error: record.error,
  });
}

async function defaultValidateOutput(fileStat, { path: filePath, expected }) {
  try {
    const details = await fileStat(filePath);
    return Object.freeze({
      valid: details.isFile() && details.size > 0 && details.size <= expected.maxBytes,
      bytes: details.size,
      durationSeconds: null,
      format: expected.format,
    });
  } catch {
    return Object.freeze({ valid: false, bytes: 0, durationSeconds: null, format: null });
  }
}

export function createMediaControl({
  fileGrants,
  ffmpegAdapter,
  ffmpegPath = 'ffmpeg',
  outputRoot = path.join(tmpdir(), 'toolbraid-media-output'),
  validateOutput,
  stat = nodeStat,
  mkdir: makeDirectory = mkdir,
  removeFile = (filePath) => rm(filePath, { force: true }),
  now = Date.now,
  randomBytes = nodeRandomBytes,
  maxActiveJobs = DEFAULT_MAX_ACTIVE_JOBS,
  maxRetainedJobs = DEFAULT_MAX_RETAINED_JOBS,
} = {}) {
  if (!fileGrants || typeof fileGrants.resolveOnce !== 'function'
    || typeof fileGrants.createFromPath !== 'function' || typeof fileGrants.revoke !== 'function') {
    throw new TypeError('Shared FileGrantStore methods are required.');
  }
  if (ffmpegAdapter !== undefined && typeof ffmpegAdapter?.run !== 'function') {
    throw new TypeError('ffmpegAdapter.run must be a function.');
  }
  if (typeof validateOutput !== 'undefined' && typeof validateOutput !== 'function') {
    throw new TypeError('validateOutput must be a function.');
  }
  if (!Number.isInteger(maxActiveJobs) || maxActiveJobs < 1 || maxActiveJobs > 16
    || !Number.isInteger(maxRetainedJobs) || maxRetainedJobs < maxActiveJobs || maxRetainedJobs > 512) {
    throw new RangeError('Media job retention limits are invalid.');
  }
  const adapter = ffmpegAdapter ?? defaultAdapter(ffmpegPath);
  const root = path.resolve(outputRoot);
  const records = new Map();
  let activeJobs = 0;

  function allocateJobId() {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const token = randomBytes(16).toString('hex');
      const jobId = `media-${token}`;
      if (/^media-[a-f0-9]{32}$/.test(jobId) && !records.has(jobId)) return jobId;
    }
    fail('MEDIA_JOB_ID_FAILED', 'A unique media job id could not be created.');
  }

  function pruneTerminalRecords() {
    if (records.size < maxRetainedJobs) return;
    for (const [jobId, record] of records) {
      if (records.size < maxRetainedJobs) break;
      if (TERMINAL_STATUSES.has(record.status)) records.delete(jobId);
    }
    if (records.size >= maxRetainedJobs) fail('MEDIA_JOB_CAPACITY', 'Media job capacity is exhausted.');
  }

  function ownedRecord(jobId, ownerId) {
    const record = records.get(jobId);
    if (!record || record.ownerId !== ownerId) fail('MEDIA_JOB_NOT_FOUND', 'Media job was not found.');
    return record;
  }

  async function execute(record, spec, outputPath) {
    const outputToken = Symbol('media-output');
    let outputGrant = null;
    let innerJobId = null;
    let mediaJobs;
    const wrappedAdapter = Object.freeze({
      async run(args, context) {
        innerJobId = context.jobId;
        if (record.cancelRequested) mediaJobs.cancel(innerJobId);
        return adapter.run(args, context);
      },
    });
    mediaJobs = createMediaJobs({
      async resolveGrant(grant, { mode }) {
        if (record.cancelRequested) fail('MEDIA_JOB_CANCELLED', 'Media job was cancelled.');
        if (mode === 'write') {
          if (grant !== outputToken) fail('MEDIA_JOB_GRANT', 'Output grant could not be resolved.');
          return Object.freeze({ path: outputPath });
        }
        return fileGrants.resolveOnce(grant, record.ownerId);
      },
      ffmpegAdapter: wrappedAdapter,
      validateOutput: (details) => validateOutput
        ? validateOutput(details)
        : defaultValidateOutput(stat, details),
      nowRef: now,
    });
    record.abort = () => {
      if (innerJobId) mediaJobs.cancel(innerJobId);
    };

    try {
      await mediaJobs.run({ ...spec, outputGrant: outputToken });
      if (record.cancelRequested) fail('MEDIA_JOB_CANCELLED', 'Media job was cancelled.');
      outputGrant = publicGrant(await fileGrants.createFromPath(outputPath, record.ownerId));
      if (record.cancelRequested) {
        await fileGrants.revoke({ grantId: outputGrant.grantId }, record.ownerId);
        fail('MEDIA_JOB_CANCELLED', 'Media job was cancelled.');
      }
      record.output = outputGrant;
      record.status = 'complete';
      record.updatedAt = now();
    } catch (error) {
      if (outputGrant) {
        try { await fileGrants.revoke({ grantId: outputGrant.grantId }, record.ownerId); } catch { /* best effort */ }
      }
      record.status = record.cancelRequested || error?.code === 'MEDIA_JOB_CANCELLED' ? 'cancelled' : 'failed';
      record.error = publicError(error, record.status === 'cancelled');
      record.updatedAt = now();
      try { await removeFile(outputPath); } catch { /* best effort */ }
    } finally {
      record.abort = null;
      activeJobs -= 1;
    }
  }

  return Object.freeze({
    operations: OPERATIONS,

    async create(input = {}, ownerId) {
      const owner = requireOwnerId(ownerId);
      const spec = normalizeCreate(input);
      if (activeJobs >= maxActiveJobs) fail('MEDIA_JOB_CAPACITY', 'Media job capacity is exhausted.');
      pruneTerminalRecords();
      const jobId = allocateJobId();
      const createdAt = now();
      const outputPath = path.join(root, `${jobId}.${spec.expectedOutput.format}`);
      const record = {
        jobId,
        ownerId: owner,
        operation: spec.operation,
        status: 'running',
        createdAt,
        updatedAt: createdAt,
        output: null,
        error: null,
        cancelRequested: false,
        abort: null,
      };
      records.set(jobId, record);
      activeJobs += 1;
      try {
        await makeDirectory(root, { recursive: true });
      } catch {
        records.delete(jobId);
        activeJobs -= 1;
        fail('MEDIA_JOB_OUTPUT_UNAVAILABLE', 'The media output area is unavailable.');
      }
      void execute(record, spec, outputPath);
      return publicState(record);
    },

    async state(input = {}, ownerId) {
      const owner = requireOwnerId(ownerId);
      return publicState(ownedRecord(normalizeLookup(input), owner));
    },

    async cancel(input = {}, ownerId) {
      const owner = requireOwnerId(ownerId);
      const record = ownedRecord(normalizeLookup(input), owner);
      if (!TERMINAL_STATUSES.has(record.status)) {
        record.cancelRequested = true;
        record.status = 'cancelling';
        record.updatedAt = now();
        record.abort?.();
      }
      return publicState(record);
    },
  });
}
