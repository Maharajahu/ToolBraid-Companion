const OWNER_PROFILE = 'owner-autonomous';
const HUMAN_PROFILE = 'human-gated';
const MAX_LEASE_TTL_MS = 15 * 60 * 1000;

function iso(value, field) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError(`${field} must be a valid date.`);
  return date.toISOString();
}

function boundedList(value, fallback) {
  if (value === undefined) return Object.freeze([...fallback]);
  if (!Array.isArray(value) || value.length === 0 || value.some((entry) => typeof entry !== 'string' || !entry.trim())) {
    throw new TypeError('Owner lease grants must be a non-empty array of strings.');
  }
  return Object.freeze(value.map((entry) => entry.trim()));
}

export function createLocalOwnerLease({
  now = new Date(),
  ttlMs = 5 * 60 * 1000,
  origins,
  capabilities,
} = {}) {
  if (!Number.isInteger(ttlMs) || ttlMs < 1 || ttlMs > MAX_LEASE_TTL_MS) {
    throw new RangeError(`Owner lease ttlMs must be between 1 and ${MAX_LEASE_TTL_MS}.`);
  }
  if (typeof globalThis.crypto?.randomUUID !== 'function') {
    throw new Error('A cryptographically secure randomUUID implementation is required for owner leases.');
  }
  const issuedAt = iso(now, 'now');
  return Object.freeze({
    version: 1,
    leaseId: globalThis.crypto.randomUUID(),
    issuedAt,
    expiresAt: new Date(Date.parse(issuedAt) + ttlMs).toISOString(),
    origins: boundedList(origins, ['*']),
    capabilities: boundedList(capabilities, ['*']),
  });
}

function grantMatches(grants, value) {
  return grants.includes('*') || grants.includes(value);
}

export function createOwnerAutonomyPolicy({
  profile = HUMAN_PROFILE,
  lease = null,
  now = () => new Date(),
  deny = () => false,
} = {}) {
  if (![HUMAN_PROFILE, OWNER_PROFILE].includes(profile)) throw new TypeError(`Unknown authorization profile: ${profile}`);
  if (typeof now !== 'function' || typeof deny !== 'function') throw new TypeError('Owner policy callbacks must be functions.');

  return Object.freeze({
    profile,
    decide(context) {
      if (deny(context)) return Object.freeze({ decision: 'deny', reason: 'policy-denied' });
      if (profile === HUMAN_PROFILE || context.classification !== 'mutate') {
        return Object.freeze({ decision: 'manual', reason: 'human-gated' });
      }
      const checkedAt = Date.parse(iso(now(), 'now'));
      if (!lease || lease.version !== 1 || !Array.isArray(lease.origins) || !Array.isArray(lease.capabilities)
        || checkedAt < Date.parse(lease.issuedAt) || checkedAt >= Date.parse(lease.expiresAt)) {
        return Object.freeze({ decision: 'manual', reason: 'owner-lease-missing-or-expired' });
      }
      if (!grantMatches(lease.origins, context.origin) || !grantMatches(lease.capabilities, context.capability)) {
        return Object.freeze({ decision: 'manual', reason: 'owner-lease-scope-mismatch' });
      }
      return Object.freeze({ decision: 'auto', reason: 'owner-lease', leaseId: lease.leaseId });
    },
  });
}

export { HUMAN_PROFILE, OWNER_PROFILE, MAX_LEASE_TTL_MS };
