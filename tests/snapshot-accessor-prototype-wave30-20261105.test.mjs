import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSnapshot, displayNode } from '../web/snapshot-policy.mjs';

const TS = '2026-11-05T16:00:00Z';
function fixture() {
  return {
    schemaVersion: 1, snapshotId: 'safe-snapshot', status: 'complete',
    startedAt: TS, finishedAt: TS,
    supervisors: [{ id: 'root', parentId: null, generation: 1, status: 'running', observedAt: TS }],
    actors: [{ id: 'worker', supervisorId: 'root', generation: 1, status: 'running', observedAt: TS }],
    missingSupervisorIds: [], warnings: []
  };
}

test('snapshot rejects accessor identity without executing attacker code', () => {
  const s = fixture();
  let reads = 0;
  Object.defineProperty(s.actors[0], 'id', {
    enumerable: true, get() { reads++; throw Error('getter executed'); }
  });
  assert.throws(() => validateSnapshot(s), /Missing snapshot field: id/);
  assert.equal(reads, 0);
});

test('inherited actor identity cannot satisfy required own-data field', () => {
  const s = fixture();
  const actor = Object.create({ id: 'inherited-worker' });
  Object.assign(actor, { supervisorId: 'root', generation: 1, status: 'running', observedAt: TS });
  s.actors = [actor];
  assert.throws(() => validateSnapshot(s), /Missing snapshot field: id/);
});

test('display metadata excludes accessors, inherited fields, and internal keys', () => {
  let reads = 0;
  const source = Object.create({ status: 'inherited', mailboxDepth: 123 });
  Object.defineProperty(source, 'id', { enumerable: true, get() { reads++; return 'unsafe'; } });
  source.supervisorId = 'root';
  source.privateSecret = 'do not render';
  assert.deepEqual(displayNode('actor', source), { kind: 'actor', supervisorId: 'root' });
  assert.equal(reads, 0);
});
