import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { FileGrantStore, createFileGrantMethods } from '../../bridge/file-grants.mjs';
import { createMediaControl } from '../../bridge/media-control.mjs';

const OWNER = 'owner-client-0123456789abcdef';
const OTHER_OWNER = 'other-client-0123456789abcdef';

async function waitFor(control, jobId, ownerId, status) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const state = await control.state({ jobId }, ownerId);
    if (state.status === status) return state;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Media job did not reach ${status}.`);
}

async function filesystemHarness(t, adapter) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tb-media-control-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const inputPath = path.join(directory, 'input.mp4');
  await writeFile(inputPath, 'input-media', 'utf8');
  const fileGrants = createFileGrantMethods(new FileGrantStore());
  const input = await fileGrants.createFromPath(inputPath, OWNER);
  const control = createMediaControl({
    fileGrants,
    ffmpegAdapter: adapter,
    outputRoot: path.join(directory, 'outputs'),
  });
  return { control, directory, fileGrants, input, inputPath };
}

test('consumes owner input grants once and returns completed output only as a FileGrant', async (t) => {
  const h = await filesystemHarness(t, {
    async run(args) {
      await writeFile(args.at(-1), 'generated-frame', 'utf8');
    },
  });
  const created = await h.control.create({
    operation: 'thumbnail',
    inputGrantIds: [h.input.grantId],
    atSeconds: 0,
    expectedOutput: { maxBytes: 1024, format: 'png' },
  }, OWNER);
  assert.equal(created.status, 'running');
  assert.equal(created.output, null);

  const completed = await waitFor(h.control, created.jobId, OWNER, 'complete');
  assert.equal(completed.operation, 'thumbnail');
  assert.match(completed.output.grantId, /^[a-f0-9]{64}$/);
  assert.equal(completed.output.basename, `${created.jobId}.png`);
  assert.equal(JSON.stringify(completed).includes(h.directory), false);
  assert.equal(JSON.stringify(completed).includes(h.inputPath), false);
  assert.equal(Object.hasOwn(completed.output, 'path'), false);

  await assert.rejects(
    h.fileGrants.resolveOnce(h.input.grantId, OWNER),
    (error) => error.code === 'FILE_GRANT_NOT_FOUND',
  );
  const output = await h.fileGrants.resolveOnce(completed.output.grantId, OWNER);
  assert.equal(await readFile(output.path, 'utf8'), 'generated-frame');
  await assert.rejects(
    h.fileGrants.resolveOnce(completed.output.grantId, OWNER),
    (error) => error.code === 'FILE_GRANT_NOT_FOUND',
  );
});

test('binds state and cancellation to the creating owner and cancels the running ffmpeg job', async (t) => {
  let started;
  const running = new Promise((resolve) => { started = resolve; });
  const h = await filesystemHarness(t, {
    run(_args, { signal }) {
      started();
      return new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      });
    },
  });
  const created = await h.control.create({
    operation: 'thumbnail',
    inputGrantIds: [h.input.grantId],
    atSeconds: 0,
    expectedOutput: { maxBytes: 1024 },
  }, OWNER);
  await running;

  await assert.rejects(
    h.control.state({ jobId: created.jobId }, OTHER_OWNER),
    (error) => error.code === 'MEDIA_JOB_NOT_FOUND',
  );
  await assert.rejects(
    h.control.cancel({ jobId: created.jobId }, OTHER_OWNER),
    (error) => error.code === 'MEDIA_JOB_NOT_FOUND',
  );
  assert.equal((await h.control.cancel({ jobId: created.jobId }, OWNER)).status, 'cancelling');
  const cancelled = await waitFor(h.control, created.jobId, OWNER, 'cancelled');
  assert.deepEqual(cancelled.error, { code: 'MEDIA_JOB_CANCELLED', message: 'Media job was cancelled.' });
  assert.equal(cancelled.output, null);
  assert.equal(JSON.stringify(cancelled).includes(h.directory), false);
});

test('rejects non-allowlisted or unbounded requests before consuming any grant', async () => {
  let resolutions = 0;
  const fileGrants = {
    async resolveOnce() { resolutions += 1; return { path: 'C:\\private\\input.mp4' }; },
    async createFromPath() { throw new Error('must not run'); },
    async revoke() { return { revoked: false }; },
  };
  const control = createMediaControl({
    fileGrants,
    ffmpegAdapter: { async run() { throw new Error('must not run'); } },
    mkdir: async () => {},
  });
  const grantId = 'ab'.repeat(32);
  const base = { inputGrantIds: [grantId], expectedOutput: { maxBytes: 1024 } };

  await assert.rejects(
    control.create({ ...base, operation: 'shell' }, OWNER),
    (error) => error.code === 'MEDIA_JOB_OPERATION',
  );
  await assert.rejects(
    control.create({ ...base, operation: 'transcode', codec: 'copy;calc' }, OWNER),
    (error) => error.code === 'MEDIA_JOB_CODEC',
  );
  await assert.rejects(
    control.create({ ...base, operation: 'thumbnail', atSeconds: 0, outputPath: 'C:\\private\\leak.png' }, OWNER),
    (error) => error.code === 'MEDIA_JOB_ARGUMENTS_INVALID' && !error.message.includes('private'),
  );
  await assert.rejects(
    control.create({ ...base, operation: 'thumbnail', atSeconds: 0, expectedOutput: { maxBytes: 20 * 1024 * 1024 * 1024 + 1 } }, OWNER),
    (error) => error.code === 'MEDIA_JOB_BOUNDS',
  );
  await assert.rejects(
    control.create({ ...base, operation: 'thumbnail', atSeconds: 0, expectedOutput: { maxBytes: 1024, format: '../png' } }, OWNER),
    (error) => error.code === 'MEDIA_JOB_FORMAT',
  );
  await assert.rejects(
    control.create({ operation: 'concat', inputGrantIds: Array(33).fill(grantId), expectedOutput: { maxBytes: 1024 } }, OWNER),
    (error) => error.code === 'MEDIA_JOB_INPUTS',
  );
  assert.equal(resolutions, 0);
  assert.deepEqual(control.operations, ['trim', 'concat', 'transcode', 'burn-subtitles', 'thumbnail']);
  assert.equal(Object.isFrozen(control.operations), true);
});

test('redacts adapter errors and retains only bounded public failure metadata', async (t) => {
  const h = await filesystemHarness(t, {
    async run(args) {
      throw new Error(`ffmpeg failed for ${args.join(' ')}`);
    },
  });
  const created = await h.control.create({
    operation: 'thumbnail',
    inputGrantIds: [h.input.grantId],
    atSeconds: 0,
    expectedOutput: { maxBytes: 1024 },
  }, OWNER);
  const failed = await waitFor(h.control, created.jobId, OWNER, 'failed');
  assert.deepEqual(failed.error, { code: 'MEDIA_JOB_FAILED', message: 'Media job failed.' });
  assert.equal(failed.output, null);
  assert.equal(JSON.stringify(failed).includes(h.directory), false);
  assert.equal(JSON.stringify(failed).includes(h.inputPath), false);
});

test('reserves bounded active-job capacity before asynchronous output setup', async () => {
  let releaseDirectory;
  const directoryReady = new Promise((resolve) => { releaseDirectory = resolve; });
  const fileGrants = {
    async resolveOnce() { return { path: 'C:\\internal\\input.mp4' }; },
    async createFromPath() { throw new Error('must not run'); },
    async revoke() { return { revoked: false }; },
  };
  const control = createMediaControl({
    fileGrants,
    ffmpegAdapter: {
      run(_args, { signal }) {
        return new Promise((resolve, reject) => {
          signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        });
      },
    },
    mkdir: () => directoryReady,
    maxActiveJobs: 1,
    maxRetainedJobs: 1,
  });
  const request = {
    operation: 'thumbnail',
    inputGrantIds: ['cd'.repeat(32)],
    atSeconds: 0,
    expectedOutput: { maxBytes: 1024 },
  };
  const firstPending = control.create(request, OWNER);
  await Promise.resolve();
  await assert.rejects(
    control.create(request, OWNER),
    (error) => error.code === 'MEDIA_JOB_CAPACITY',
  );
  releaseDirectory();
  const first = await firstPending;
  await new Promise((resolve) => setImmediate(resolve));
  await control.cancel({ jobId: first.jobId }, OWNER);
  await waitFor(control, first.jobId, OWNER, 'cancelled');
});
