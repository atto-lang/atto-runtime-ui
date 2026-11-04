// UI presentation contract. Server authorization/sanitization remains mandatory.
const FIELDS = Object.freeze({
  supervisor: ['id', 'parentId', 'status', 'generation', 'observedAt'],
  actor: ['id', 'supervisorId', 'spawnedBy', 'status', 'generation', 'observedAt', 'mailboxDepth', 'inFlightRequests'],
});
const MAX_TEXT = 256;
export const MAX_NODES = 10000;
export const MAX_DEPTH = 64;
const SNAPSHOT_STATUSES = new Set(['pending', 'partial', 'complete']);
const NODE_STATUSES = new Set([
  'starting', 'running', 'stopping', 'stopped', 'failed', 'terminated',
  'observed', 'unresponsive', 'terminated-during-snapshot', 'unknown', 'partial',
]);
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;

function ownData(source, key) {
  const descriptor = Object.getOwnPropertyDescriptor(source, key);
  return descriptor && Object.hasOwn(descriptor, 'value')
    ? { present: true, value: descriptor.value }
    : { present: false };
}
function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function field(source, key) {
  if (!record(source)) throw Error('Invalid snapshot record');
  const descriptor = ownData(source, key);
  if (!descriptor.present) throw Error('Missing snapshot field: ' + key);
  return descriptor.value;
}
function boundedId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_TEXT &&
    !/[\u0000-\u001f\u007f]/.test(value);
}
function identity(source, key) {
  const value = field(source, key);
  if (!boundedId(value)) throw Error('Invalid snapshot identity: ' + key);
  return value;
}
function time(source, key) {
  const value = field(source, key);
  if (typeof value !== 'string' || !ISO_UTC.test(value) || !Number.isFinite(Date.parse(value))) {
    throw Error('Invalid observation time: ' + key);
  }
  return value;
}
function nodeCheck(node) {
  identity(node, 'id');
  const generation = field(node, 'generation');
  if (!Number.isSafeInteger(generation) || generation < 0) throw Error('Invalid node generation');
  if (!NODE_STATUSES.has(field(node, 'status'))) throw Error('Unknown node status');
  time(node, 'observedAt');
}

// Validate the full protocol before the caller touches the DOM. Partial data
// must never be silently reclassified as complete or healthy.
export function validateSnapshot(snapshot) {
  if (!record(snapshot) || field(snapshot, 'schemaVersion') !== 1) throw Error('Unsupported snapshot schema');
  const status = field(snapshot, 'status');
  if (!SNAPSHOT_STATUSES.has(status)) throw Error('Unknown snapshot status');
  identity(snapshot, 'snapshotId');
  time(snapshot, 'startedAt');
  if (status !== 'pending') time(snapshot, 'finishedAt');
  const supervisors = field(snapshot, 'supervisors');
  const actors = field(snapshot, 'actors');
  if (!Array.isArray(supervisors) || !Array.isArray(actors) ||
      supervisors.length + actors.length > MAX_NODES) throw Error('Snapshot exceeds UI node limit');
  const warnings = ownData(snapshot, 'warnings');
  if (warnings.present && (!Array.isArray(warnings.value) || warnings.value.length > 128 ||
      warnings.value.some(w => typeof w !== 'string' || w.length > MAX_TEXT))) {
    throw Error('Invalid snapshot warnings');
  }
  const missing = ownData(snapshot, 'missingSupervisorIds');
  if (missing.present && (!Array.isArray(missing.value) || missing.value.length > MAX_NODES)) {
    throw Error('Invalid missing-supervisor inventory');
  }
  const byId = new Map();
  const allIds = new Set();
  let roots = 0;
  for (const supervisor of supervisors) {
    nodeCheck(supervisor);
    if (allIds.has(supervisor.id)) throw Error('Duplicate runtime node ID');
    allIds.add(supervisor.id);
    byId.set(supervisor.id, supervisor);
    if (field(supervisor, 'parentId') === null) roots++;
  }
  for (const supervisor of supervisors) {
    if (supervisor.parentId !== null && !boundedId(supervisor.parentId)) throw Error('Invalid supervisor parent');
    if (supervisor.parentId !== null && !byId.has(supervisor.parentId)) throw Error('Orphan supervisor');
  }
  for (const actor of actors) {
    nodeCheck(actor);
    if (allIds.has(actor.id)) throw Error('Duplicate runtime node ID');
    allIds.add(actor.id);
    if (!boundedId(field(actor, 'supervisorId')) || !byId.has(actor.supervisorId)) throw Error('Orphan actor');
    const spawnedBy = ownData(actor, 'spawnedBy');
    if (spawnedBy.present && spawnedBy.value !== null && !boundedId(spawnedBy.value)) {
      throw Error('Invalid spawn lineage');
    }
  }
  if (status === 'pending' && (supervisors.length || actors.length)) {
    throw Error('Pending snapshot cannot claim observed nodes');
  }
  if (status !== 'pending' && roots !== 1) throw Error('Snapshot must have exactly one root supervisor');
  for (const supervisor of supervisors) {
    const seen = new Set();
    let current = supervisor;
    let depth = 0;
    while (current !== null) {
      if (seen.has(current.id)) throw Error('Cycle in supervision tree');
      if (depth > MAX_DEPTH) throw Error('Supervision depth exceeded');
      seen.add(current.id);
      current = current.parentId === null ? null : byId.get(current.parentId);
      depth++;
    }
  }
  if (missing.present) {
    const unique = new Set();
    for (const id of missing.value) {
      if (!boundedId(id) || unique.has(id) || allIds.has(id)) throw Error('Invalid missing supervisor ID');
      unique.add(id);
    }
    if (status === 'complete' && unique.size) throw Error('Complete snapshot omits supervisors');
  }
  if (status === 'complete' && [...supervisors, ...actors].some(s =>
    ['unresponsive', 'terminated-during-snapshot', 'unknown', 'partial'].includes(s.status))) {
    throw Error('Complete snapshot contains uncertain supervisors');
  }
  return snapshot;
}

// Only own data properties are reflected. Unexpected runtime-private keys,
// inherited properties and accessors never become display metadata.
export function displayNode(kind, source) {
  if ((kind !== 'supervisor' && kind !== 'actor') || !record(source)) {
    throw new TypeError('Invalid runtime node');
  }
  const details = { kind };
  for (const key of FIELDS[kind]) {
    const entry = ownData(source, key);
    if (!entry.present) continue;
    const value = entry.value;
    if (value === null && (key === 'parentId' || key === 'spawnedBy')) {
      details[key] = null;
    } else if (typeof value === 'string') {
      details[key] = value.length <= MAX_TEXT ? value : value.slice(0, MAX_TEXT) + '…';
    } else if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
      details[key] = value;
    }
  }
  if (kind === 'actor') {
    const entry = ownData(source, 'kind');
    if (entry.present && typeof entry.value === 'string') {
      details.actorKind = entry.value.slice(0, MAX_TEXT);
    }
  }
  return details;
}
