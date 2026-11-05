import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSnapshot } from '../web/snapshot-policy.mjs';

const TS = '2026-11-05T17:00:00Z';
function fixture() {
  return {
    schemaVersion: 1, snapshotId: 'snapshot-calendar', status: 'complete',
    startedAt: TS, finishedAt: TS,
    supervisors: [{id: 'root', parentId: null, generation: 1, status: 'running', observedAt: TS}],
    actors: [], missingSupervisorIds: [], warnings: [],
  };
}
test('invalid dates normalized by Date.parse are rejected before presenting status', () => {
  for (const date of [
    '2026-02-30T00:00:00Z', '2025-02-29T12:00:00Z',
    '2026-04-31T23:59:59Z', '2026-06-31T00:00:00Z',
  ]) {
    const snap = fixture();
    snap.supervisors[0].observedAt = date;
    assert.throws(() => validateSnapshot(snap), /Invalid observation time/, date);
  }
});
test('leap day in leap years and nanosecond timestamps remain supported', () => {
  for (const date of [
    '2024-02-29T00:00:00Z', '2000-02-29T23:59:59.123456789Z',
    '2026-11-05T17:00:00.000000001Z',
  ]) {
    const snap = fixture();
    snap.startedAt = date;
    snap.finishedAt = date;
    snap.supervisors[0].observedAt = date;
    assert.equal(validateSnapshot(snap).status, 'complete');
  }
});
test('invalid startedAt and finishedAt fail closed as well as node observations', () => {
  for (const key of ['startedAt', 'finishedAt']) {
    const snap = fixture();
    snap[key] = '2026-02-30T17:00:00Z';
    assert.throws(() => validateSnapshot(snap), /Invalid observation time/);
  }
});
