const HASH = /^[a-f0-9]{64}$/;
const MAX_DIMENSION = 32_768;

function integer(value, name, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) throw new RangeError(`${name} must be an integer from ${min} through ${max}.`);
  return value;
}

function viewport(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('viewport is required.');
  return Object.freeze({ width: integer(value.width, 'viewport.width', 1, MAX_DIMENSION), height: integer(value.height, 'viewport.height', 1, MAX_DIMENSION), deviceScaleFactor: value.deviceScaleFactor === undefined ? 1 : integer(value.deviceScaleFactor, 'viewport.deviceScaleFactor', 1, 8) });
}

export function createVisualTargetDescriptor({ screenshotHash, viewport: rawViewport, x, y, radius = 1, label = 'visual target', origin = null } = {}) {
  if (typeof screenshotHash !== 'string' || !HASH.test(screenshotHash)) throw new TypeError('screenshotHash must be a lowercase SHA-256 hex digest.');
  const boundViewport = viewport(rawViewport);
  const point = Object.freeze({ x: integer(x, 'x', 0, boundViewport.width - 1), y: integer(y, 'y', 0, boundViewport.height - 1), radius: integer(radius, 'radius', 1, 256) });
  return Object.freeze({
    version: 1,
    type: 'visual-target',
    label: String(label).replace(/\s+/g, ' ').trim().slice(0, 180) || 'visual target',
    origin,
    screenshotHash,
    viewport: boundViewport,
    point,
    inputSchema: Object.freeze({ type: 'object', properties: {}, additionalProperties: false }),
    annotations: Object.freeze({ readOnlyHint: false, destructiveHint: false, openWorldHint: true }),
  });
}

/** Exact binding validation: recapture hash and every viewport field must still match. */
export function revalidateVisualTarget(descriptor, capture) {
  if (descriptor?.type !== 'visual-target') throw new TypeError('A visual-target descriptor is required.');
  let currentViewport;
  try { currentViewport = viewport(capture?.viewport); } catch { return Object.freeze({ ok: false, reason: 'viewport-invalid' }); }
  if (typeof capture?.screenshotHash !== 'string' || !HASH.test(capture.screenshotHash)) return Object.freeze({ ok: false, reason: 'screenshot-hash-invalid' });
  if (capture.screenshotHash !== descriptor.screenshotHash) return Object.freeze({ ok: false, reason: 'screenshot-drift' });
  if (currentViewport.width !== descriptor.viewport.width || currentViewport.height !== descriptor.viewport.height || currentViewport.deviceScaleFactor !== descriptor.viewport.deviceScaleFactor) return Object.freeze({ ok: false, reason: 'viewport-drift' });
  if (descriptor.origin && capture.origin !== descriptor.origin) return Object.freeze({ ok: false, reason: 'origin-drift' });
  return Object.freeze({ ok: true, reason: 'binding-valid', point: descriptor.point });
}

export const VISUAL_TARGET_MAX_DIMENSION = MAX_DIMENSION;
