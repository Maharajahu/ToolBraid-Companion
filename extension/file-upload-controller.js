/**
 * Privileged, path-redacting file upload primitive.
 *
 * Target resolution and post-verification stay in the isolated content world
 * through the injected callbacks. The debugger is attached only for the short
 * DOM.setFileInputFiles operation and is detached on every exit path.
 */

const MARKER_ATTRIBUTE = 'data-toolbraid-file-target';
const CDP_VERSION = '1.3';

export class FileUploadError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'FileUploadError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new FileUploadError(code, message);
}

function randomMarker(randomSource) {
  if (typeof randomSource?.randomUUID === 'function') return `tb-${randomSource.randomUUID()}`;
  if (typeof randomSource?.getRandomValues !== 'function') fail('SECURE_RANDOM_UNAVAILABLE', 'Secure randomness is required for file target marking.');
  const bytes = new Uint8Array(24);
  randomSource.getRandomValues(bytes);
  return `tb-${[...bytes].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

function expectedSummary(expectedFile) {
  if (!expectedFile || typeof expectedFile !== 'object' || Array.isArray(expectedFile)) fail('EXPECTED_FILE_INVALID', 'Expected file metadata is required.');
  const name = typeof expectedFile.name === 'string' ? expectedFile.name.trim() : '';
  const size = expectedFile.size;
  const count = expectedFile.count ?? 1;
  if (!name || name.includes('/') || name.includes('\\') || !Number.isSafeInteger(size) || size < 0 || !Number.isSafeInteger(count) || count < 1) {
    fail('EXPECTED_FILE_INVALID', 'Expected file metadata must contain a basename, byte size, and positive count.');
  }
  return Object.freeze({ name, size, count });
}

function assertInputs({ binding, targetRef, resolvedLocalPath, tabId, markTarget, revalidateTarget, verifyTarget, cleanupTarget }) {
  if (!binding || typeof binding !== 'object' || Array.isArray(binding)) fail('BINDING_INVALID', 'An exact page binding is required.');
  if (binding.tabId !== tabId || !Number.isInteger(binding.frameId) || binding.frameId < 0
    || typeof binding.sessionId !== 'string' || !binding.sessionId.trim()
    || typeof binding.origin !== 'string' || !binding.origin.trim()
    || typeof (binding.pageFingerprint ?? binding.canonicalPageFingerprint) !== 'string'
    || !(binding.pageFingerprint ?? binding.canonicalPageFingerprint).trim()) {
    fail('BINDING_INVALID', 'A matching tab, frame, session, origin, and page fingerprint binding is required.');
  }
  if (typeof targetRef !== 'string' || !targetRef.trim()) fail('TARGET_REF_INVALID', 'An exact file input ref is required.');
  if (typeof resolvedLocalPath !== 'string' || !resolvedLocalPath.trim()) fail('LOCAL_FILE_INVALID', 'A resolved local file is required.');
  if (!Number.isInteger(tabId) || tabId < 0) fail('TAB_ID_INVALID', 'A non-negative tab id is required.');
  if (typeof markTarget !== 'function' || typeof revalidateTarget !== 'function'
    || typeof verifyTarget !== 'function' || typeof cleanupTarget !== 'function') {
    fail('CONTENT_HOOKS_REQUIRED', 'Isolated target mark, revalidation, verification, and cleanup hooks are required.');
  }
}

function flattenDocument(root, limit = 10_000) {
  const nodes = [];
  const stack = root ? [root] : [];
  const seen = new Set();
  while (stack.length && nodes.length < limit) {
    const node = stack.pop();
    if (!node || seen.has(node)) continue;
    seen.add(node);
    nodes.push(node);
    const descendants = [
      ...(Array.isArray(node.children) ? node.children : []),
      ...(Array.isArray(node.shadowRoots) ? node.shadowRoots : []),
      ...(node.contentDocument ? [node.contentDocument] : []),
    ];
    for (let index = descendants.length - 1; index >= 0; index -= 1) stack.push(descendants[index]);
  }
  if (stack.length) fail('FILE_TARGET_SCAN_LIMIT', 'The debugger DOM exceeded the bounded target scan.');
  return nodes;
}

function attributeMap(attributes) {
  const result = new Map();
  for (let index = 0; index + 1 < (attributes?.length ?? 0); index += 2) result.set(String(attributes[index]).toLowerCase(), String(attributes[index + 1]));
  return result;
}

function findMarkedFileNode(nodes, marker) {
  const matches = [];
  for (const node of nodes ?? []) {
    if (String(node?.nodeName ?? '').toLowerCase() !== 'input') continue;
    const attrs = attributeMap(node.attributes);
    if (attrs.get(MARKER_ATTRIBUTE) === marker && String(attrs.get('type') ?? '').toLowerCase() === 'file') matches.push(node);
  }
  if (matches.length !== 1) fail(matches.length ? 'FILE_TARGET_AMBIGUOUS' : 'FILE_TARGET_NOT_FOUND', 'The exact marked file input could not be resolved.');
  const node = matches[0];
  if (!Number.isInteger(node.backendNodeId) || node.backendNodeId <= 0) fail('FILE_TARGET_NOT_FOUND', 'The marked file input has no debugger node identity.');
  return node;
}

function assertVerification(result, expected) {
  if (!result || result.ok !== true) fail(result?.error?.code ?? 'FILE_UPLOAD_VERIFY_FAILED', 'The selected file could not be verified.');
  const actual = result.file;
  if (!actual || actual.name !== expected.name || actual.size !== expected.size || actual.count !== expected.count) {
    fail('FILE_UPLOAD_POSTCONDITION_FAILED', 'The selected file metadata did not match the expected basename, size, and count.');
  }
}

export function createFileUploadController({ chromeApi = globalThis.chrome, randomSource = globalThis.crypto } = {}) {
  const debuggerApi = chromeApi?.debugger;
  if (!debuggerApi?.attach || !debuggerApi?.detach || !debuggerApi?.sendCommand) {
    fail('DEBUGGER_UNAVAILABLE', 'Chrome debugger access is unavailable.');
  }

  return Object.freeze({
    async upload({ binding, targetRef, resolvedLocalPath, expectedFile, tabId = binding?.tabId, markTarget, revalidateTarget, verifyTarget, cleanupTarget }) {
      assertInputs({ binding, targetRef, resolvedLocalPath, tabId, markTarget, revalidateTarget, verifyTarget, cleanupTarget });
      const expected = expectedSummary(expectedFile);
      const marker = randomMarker(randomSource);
      const debuggee = { tabId };
      let marked = false;
      let attached = false;
      let selectionDispatched = false;
      try {
        const markResult = await markTarget({ binding, targetRef, marker, attribute: MARKER_ATTRIBUTE });
        if (!markResult || markResult.ok !== true) fail(markResult?.error?.code ?? 'FILE_TARGET_MARK_FAILED', 'The exact file input could not be marked.');
        marked = true;

        await debuggerApi.attach(debuggee, CDP_VERSION);
        attached = true;
        await debuggerApi.sendCommand(debuggee, 'DOM.enable');
        await debuggerApi.sendCommand(debuggee, 'Runtime.enable');
        const documentTree = await debuggerApi.sendCommand(debuggee, 'DOM.getDocument', { depth: -1, pierce: true });
        const node = findMarkedFileNode(flattenDocument(documentTree?.root), marker);

        const revalidation = await revalidateTarget({ binding, targetRef, marker, attribute: MARKER_ATTRIBUTE });
        if (!revalidation || revalidation.ok !== true) {
          fail(revalidation?.error?.code ?? 'FILE_TARGET_BINDING_MISMATCH', 'The exact marked file input changed before attachment.');
        }
        const confirmedTree = await debuggerApi.sendCommand(debuggee, 'DOM.getDocument', { depth: -1, pierce: true });
        const confirmedNode = findMarkedFileNode(flattenDocument(confirmedTree?.root), marker);
        if (confirmedNode.backendNodeId !== node.backendNodeId) {
          fail('FILE_TARGET_BINDING_MISMATCH', 'The marked file input identity changed before attachment.');
        }
        selectionDispatched = true;
        await debuggerApi.sendCommand(debuggee, 'DOM.setFileInputFiles', {
          files: [resolvedLocalPath],
          backendNodeId: confirmedNode.backendNodeId,
        });

        const verification = await verifyTarget({ binding, targetRef, marker, attribute: MARKER_ATTRIBUTE });
        assertVerification(verification, expected);
        return Object.freeze({ ok: true, file: expected });
      } catch (error) {
        if (selectionDispatched) {
          throw new FileUploadError('FILE_UPLOAD_OUTCOME_UNKNOWN', 'File selection was dispatched but could not be verified. The page may already have received the file; inspect its attachments before retrying.');
        }
        if (error instanceof FileUploadError) throw error;
        throw new FileUploadError(error?.code ?? 'FILE_UPLOAD_FAILED', 'The local file upload operation failed.');
      } finally {
        if (marked) {
          try { await cleanupTarget({ binding, targetRef, marker, attribute: MARKER_ATTRIBUTE }); } catch { /* best-effort marker cleanup */ }
        }
        if (attached) {
          try { await debuggerApi.detach(debuggee); } catch { /* debugger lifecycle is already ending */ }
        }
      }
    },
  });
}

export const FILE_UPLOAD_MARKER_ATTRIBUTE = MARKER_ATTRIBUTE;
