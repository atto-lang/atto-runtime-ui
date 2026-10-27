// Deliberately narrow presentation contract: a supervisor response may contain
// runtime-private fields; these must never be reflected in the public DOM.
const FIELDS = Object.freeze({
  supervisor: ["id", "parentId", "status", "generation", "observedAt"],
  actor: ["id", "supervisorId", "spawnedBy", "kind", "status", "generation", "observedAt", "mailboxDepth", "inFlightRequests"],
});
const MAX_TEXT = 256;
export function displayNode(kind, source) {
  if (!(kind in FIELDS) || !source || typeof source !== "object" || Array.isArray(source)) {
    throw new TypeError("Invalid runtime node");
  }
  const details = { kind };
  for (const key of FIELDS[kind]) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
    const value = source[key];
    if (value === null && (key === "parentId" || key === "spawnedBy")) {
      details[key] = null;
    } else if (typeof value === "string") {
      details[key] = value.length <= MAX_TEXT ? value : value.slice(0, MAX_TEXT) + "…";
    } else if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
      details[key] = value;
    }
  }
  return details;
}
