// Host-side, read-only observation boundary. This is NOT a native Oreslang
// supervisor CONTROL implementation or an HTTP authentication mechanism.
// Only trusted boot code may retain authority; request handlers get broker.
import {validateSnapshot, MAX_NODES, MAX_DEPTH} from '../web/snapshot-policy.mjs';

const MAX_ACTIVE = 8;
const MAX_TTL_MS = 60_000;
const MAX_WAIT_MS = 5_000;
const MAX_BYTES = 1024 * 1024;

export class ObservationError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ObservationError';
    this.code = code;
  }
}
function fail(code) { throw new ObservationError(code); }
function record(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
function own(source, key) {
  if (!record(source)) fail('INVALID_SNAPSHOT');
  const desc = Object.getOwnPropertyDescriptor(source, key);
  if (!desc || !Object.hasOwn(desc, 'value')) fail('INVALID_SNAPSHOT');
  return desc.value;
}
function optional(source, key) {
  const desc = Object.getOwnPropertyDescriptor(source, key);
  if (!desc) return undefined;
  if (!Object.hasOwn(desc, 'value')) fail('INVALID_SNAPSHOT');
  return desc.value;
}
function boundedId(s) {
  return typeof s === 'string' && s.length > 0 && s.length <= 256 &&
    !/[\u0000-\u001f\u007f]/.test(s);
}
function safeInt(i) { return Number.isSafeInteger(i) && i >= 0; }
function safeLimit(i, max) { return Number.isSafeInteger(i) && i >= 1 && i <= max; }
function immutableNode(node, fields) {
  const selected = Object.create(null);
  for (const key of fields) selected[key] = own(node, key);
  return Object.freeze(selected);
}
function project(raw, grant, maxNodes) {
  if (own(raw, 'tenantId') !== grant.tenantId ||
      own(raw, 'scopeRootId') !== grant.scopeRootId ||
      own(raw, 'scopeGeneration') !== grant.scopeGeneration) fail('INVALID_SNAPSHOT');
  const rawSupervisors = own(raw, 'supervisors');
  const rawActors = own(raw, 'actors');
  if (!Array.isArray(rawSupervisors) || !Array.isArray(rawActors) ||
      rawSupervisors.length + rawActors.length > maxNodes) fail('INVALID_SNAPSHOT');

  // Copy only approved scalar fields into new, null-prototype records. Never
  // serialize arbitrary runtime/private fields, exception strings, or getters.
  const supervisors = rawSupervisors.map(s => immutableNode(s, [
    'id', 'parentId', 'status', 'generation', 'observedAt',
  ]));
  const actors = rawActors.map(a => {
    const node = immutableNode(a, ['id', 'supervisorId', 'status', 'generation', 'observedAt']);
    const clean = Object.assign(Object.create(null), node);
    for (const field of ['spawnedBy', 'kind', 'mailboxDepth', 'inFlightRequests']) {
      const value = optional(a, field);
      if (value !== undefined) {
        if ((field === 'mailboxDepth' || field === 'inFlightRequests') && !safeInt(value)) fail('INVALID_SNAPSHOT');
        if ((field === 'spawnedBy' && value !== null && !boundedId(value)) ||
            (field === 'kind' && (!boundedId(value) || value.length > 64))) fail('INVALID_SNAPSHOT');
        clean[field] = value;
      }
    }
    return Object.freeze(clean);
  });
  const rawMissing = optional(raw, 'missingSupervisorIds');
  if (rawMissing !== undefined && (!Array.isArray(rawMissing) || rawMissing.length > maxNodes)) {
    fail('INVALID_SNAPSHOT');
  }
  const snapshot = {
    schemaVersion: own(raw, 'schemaVersion'),
    snapshotId: own(raw, 'snapshotId'),
    status: own(raw, 'status'),
    startedAt: own(raw, 'startedAt'),
    supervisors, actors,
    missingSupervisorIds: rawMissing === undefined ? [] : [...rawMissing],
    // Runtime-provided warning text must never cross the boundary.
    warnings: [],
  };
  const finishedAt = optional(raw, 'finishedAt');
  if (finishedAt !== undefined) snapshot.finishedAt = finishedAt;
  try { validateSnapshot(snapshot); } catch { fail('INVALID_SNAPSHOT'); }
  if (snapshot.status !== 'pending') {
    const roots = supervisors.filter(n => n.parentId === null);
    if (roots.length !== 1 || roots[0].id !== grant.scopeRootId ||
        roots[0].generation !== grant.scopeGeneration) fail('INVALID_SNAPSHOT');
  }
  // Reject unexpected tree size even when a trusted adapter misbehaves. The
  // browser's separate 1 MiB limit is not a substitute for a server bound.
  if (Buffer.byteLength(JSON.stringify(snapshot), 'utf8') > MAX_BYTES) fail('INVALID_SNAPSHOT');
  Object.freeze(snapshot.missingSupervisorIds);
  Object.freeze(snapshot.supervisors);
  Object.freeze(snapshot.actors);
  return Object.freeze(snapshot);
}

/**
 * Host runtime integration supplies a trusted source with snapshot(args).
 * This source MUST independently enforce tenant/supervisor CONTROL authority;
 * the broker checks response identity and applies a second disclosure fence.
 * The authority side may only be retained by trusted bootstrap code.
 */
export function createRuntimeObservationBroker({source, monotonicMs = () => performance.now()} = {}) {
  if (!source || typeof source.snapshot !== 'function' || typeof monotonicMs !== 'function') {
    throw new TypeError('Trusted supervisor snapshot source and monotonic clock required');
  }
  const grants = new WeakMap();
  const active = new Set();
  const perGrant = new WeakSet();
  let closed = false;

  function getGrant(token, subject) {
    if (!record(token) || !record(subject)) fail('DENIED');
    const grant = grants.get(token);
    if (!grant || grant.revoked || grant.subject !== subject || closed ||
        !Number.isFinite(monotonicMs()) || monotonicMs() >= grant.expiresAt) fail('DENIED');
    return grant;
  }

  const authority = Object.freeze({
    issueGrant({subject, tenantId, scopeRootId, scopeGeneration, ttlMs,
      maxNodes = MAX_NODES, maxDepth = MAX_DEPTH} = {}) {
      if (closed || !record(subject) || !boundedId(tenantId) || !boundedId(scopeRootId) ||
          !safeInt(scopeGeneration) || !safeLimit(ttlMs, MAX_TTL_MS) ||
          !safeLimit(maxNodes, MAX_NODES) || !safeLimit(maxDepth, MAX_DEPTH)) fail('DENIED');
      const now = monotonicMs();
      if (!Number.isFinite(now)) fail('DENIED');
      // Object identity is the capability. No URL token or serializable ID.
      const token = Object.freeze(Object.create(null));
      grants.set(token, {
        subject, tenantId, scopeRootId, scopeGeneration, maxNodes, maxDepth,
        expiresAt: now + ttlMs, revoked: false,
      });
      return token;
    },
    revoke(token) {
      const entry = record(token) ? grants.get(token) : undefined;
      if (!entry) return false;
      entry.revoked = true;
      for (const task of active) if (task.token === token) task.controller.abort();
      return true;
    },
    close() {
      closed = true;
      for (const task of active) task.controller.abort();
    },
  });

  const broker = Object.freeze({
    async readSnapshot({subject, grant: token, maxNodes = MAX_NODES,
      maxDepth = MAX_DEPTH, timeoutMs = MAX_WAIT_MS} = {}) {
      const grant = getGrant(token, subject);
      if (!safeLimit(maxNodes, grant.maxNodes) || !safeLimit(maxDepth, grant.maxDepth) ||
          !safeLimit(timeoutMs, MAX_WAIT_MS)) fail('DENIED');
      if (active.size >= MAX_ACTIVE || perGrant.has(token)) fail('BUSY');
      const started = monotonicMs();
      if (!Number.isFinite(started) || started >= grant.expiresAt) fail('DENIED');
      const deadlineMs = Math.min(started + timeoutMs, grant.expiresAt);
      const controller = new AbortController();
      const task = {token, controller};
      active.add(task);
      perGrant.add(token);
      // Retain quota until underlying work actually settles, even after a
      // timeout: a noncooperating native adapter may still be running.
      const sourcePromise = Promise.resolve().then(() => source.snapshot({
        tenantId: grant.tenantId,
        scopeRootId: grant.scopeRootId,
        scopeGeneration: grant.scopeGeneration,
        maxNodes, maxDepth, deadlineMs, signal: controller.signal,
      }));
      sourcePromise.then(
        () => { active.delete(task); perGrant.delete(token); },
        () => { active.delete(task); perGrant.delete(token); },
      );
      let timer;
      const aborted = new Promise((_, reject) => {
        controller.signal.addEventListener('abort', () => reject(new ObservationError('ABORTED')), {once: true});
      });
      try {
        timer = setTimeout(() => controller.abort(), Math.max(1, deadlineMs - started));
        const raw = await Promise.race([sourcePromise, aborted]);
        // Re-check after the await; successful async work cannot bypass
        // revocation, expiry, a closed broker, or a stale session identity.
        getGrant(token, subject);
        if (monotonicMs() >= deadlineMs) fail('DEADLINE_EXCEEDED');
        return project(raw, grant, maxNodes);
      } catch (err) {
        if (err instanceof ObservationError && err.code === 'INVALID_SNAPSHOT') throw err;
        if (grant.revoked || closed) fail('DENIED');
        if (controller.signal.aborted || monotonicMs() >= deadlineMs) fail('DEADLINE_EXCEEDED');
        if (err instanceof ObservationError) throw err;
        // Never reflect source exception strings, data or stack traces.
        fail('OBSERVATION_UNAVAILABLE');
      } finally {
        clearTimeout(timer);
      }
    },
  });
  return Object.freeze({authority, broker});
}
