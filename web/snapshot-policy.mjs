// Deliberately narrow presentation contract: a supervisor response may contain
// runtime-private fields; these must never be reflected in the public DOM.
const FIELDS = Object.freeze({
  supervisor: ["id", "parentId", "status", "generation", "observedAt"],
  actor: ["id", "supervisorId", "spawnedBy", "status", "generation", "observedAt", "mailboxDepth", "inFlightRequests"],
});
const MAX_TEXT = 256;

// Read only own data properties: getter access can execute arbitrary callbacks,
// throw, or reveal secrets. Normal API JSON is plain data, but the presentation
// boundary must also handle future direct JS-backed sources safely.
function dataValue(source, key) {
  const descriptor = Object.getOwnPropertyDescriptor(source, key);
  return descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value')
    ? { present: true, value: descriptor.value }
    : { present: false };
}
export function displayNode(kind, source) {
  if ((kind !== "supervisor" && kind !== "actor") ||
      !source || typeof source !== "object" || Array.isArray(source)) {
    throw new TypeError("Invalid runtime node");
  }
  const details = { kind };
  for (const key of FIELDS[kind]) {
    const entry = dataValue(source, key);
    if (!entry.present) continue;
    const value = entry.value;
    if (value === null && (key === "parentId" || key === "spawnedBy")) {
      details[key] = null;
    } else if (typeof value === "string") {
      details[key] = value.length <= MAX_TEXT ? value : value.slice(0, MAX_TEXT) + "…";
    } else if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
      details[key] = value;
    }
  }
  if (kind === 'actor') {
    const entry = dataValue(source, 'kind');
    if (entry.present && typeof entry.value === 'string') {
      details.actorKind = entry.value.slice(0, MAX_TEXT);
    }
  }
  return details;
}
