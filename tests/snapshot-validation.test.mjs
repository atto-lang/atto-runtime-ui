import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSnapshot, MAX_NODES} from '../web/snapshot-policy.mjs';
const TS = '2026-10-30T20:00:00Z';
const sup = (id, parentId = null) => ({id, parentId, generation: 1, status: 'running', observedAt: TS});
const actor = (id, supervisorId = 'root') => ({id, supervisorId, generation: 0, status: 'running', observedAt: TS});
function snapshot() {
  return {schemaVersion:1,snapshotId:'snap-1',status:'complete',startedAt:TS,finishedAt:TS,
    supervisors:[sup('root')],actors:[actor('a')],missingSupervisorIds:[],warnings:[]};
}

test('valid complete rooted snapshot accepted', () => assert.equal(validateSnapshot(snapshot()).status, 'complete'));
test('unknown state cannot be labeled complete or partial', () => {
  for (const status of [undefined, '', 'success', 'healthy', null]) {
    const s = snapshot(); s.status = status;
    assert.throws(() => validateSnapshot(s), /Unknown snapshot status/);
  }
});
test('complete cannot hide missing or unresponsive supervisors', () => {
  const s = snapshot(); s.missingSupervisorIds = ['lost'];
  assert.throws(() => validateSnapshot(s), /Complete snapshot omits/);
  s.missingSupervisorIds = []; s.supervisors[0].status = 'unresponsive';
  assert.throws(() => validateSnapshot(s), /uncertain/);
  s.status = 'partial'; assert.doesNotThrow(() => validateSnapshot(s));
});
test('duplicate IDs, missing parents and cyclic edge references fail closed', () => {
  const dup = snapshot(); dup.actors.push(actor('root'));
  assert.throws(() => validateSnapshot(dup), /Duplicate/);
  const orphan = snapshot(); orphan.actors[0].supervisorId = 'missing';
  assert.throws(() => validateSnapshot(orphan), /Orphan/);
  const cycle = snapshot(); cycle.supervisors.push(sup('loopA','loopB'),sup('loopB','loopA'));
  assert.throws(() => validateSnapshot(cycle), /Cycle/);
  const roots = snapshot(); roots.supervisors.push(sup('extra'));
  assert.throws(() => validateSnapshot(roots), /one root/);
});
test('identity, generation and observation timestamp are mandatory', () => {
  const missingGeneration = snapshot(); delete missingGeneration.actors[0].generation;
  assert.throws(() => validateSnapshot(missingGeneration), /generation/);
  const badTime = snapshot(); badTime.supervisors[0].observedAt = 'not-a-time';
  assert.throws(() => validateSnapshot(badTime), /observation time/);
  const badId = snapshot(); badId.snapshotId = 'x\nsecret';
  assert.throws(() => validateSnapshot(badId), /identity/);
});
test('partial missing inventory remains bounded and noncontradictory', () => {
  const missing = snapshot(); missing.status = 'partial'; missing.missingSupervisorIds = ['lost'];
  assert.equal(validateSnapshot(missing).status, 'partial');
  missing.missingSupervisorIds = ['lost','lost'];
  assert.throws(() => validateSnapshot(missing), /missing supervisor ID/);
  missing.missingSupervisorIds = ['a'];
  assert.throws(() => validateSnapshot(missing), /missing supervisor ID/);
});
test('no nodes in complete snapshot, budget exhaustion, oversized warnings rejected', () => {
  const empty = snapshot(); empty.supervisors = []; empty.actors = [];
  assert.throws(() => validateSnapshot(empty), /one root/);
  const tooMany = snapshot(); tooMany.actors = Array.from({length:MAX_NODES}, (_,i) => actor(String(i)));
  assert.throws(() => validateSnapshot(tooMany), /node limit/);
  const warnings = snapshot(); warnings.warnings = ['x'.repeat(257)];
  assert.throws(() => validateSnapshot(warnings), /warnings/);
});
test('pending cannot advertise observed runtime nodes', () => {
  const pending = snapshot(); pending.status = 'pending'; pending.supervisors = []; pending.actors = [];
  assert.equal(validateSnapshot(pending).status, 'pending');
  pending.supervisors.push(sup('root'));
  assert.throws(() => validateSnapshot(pending), /Pending/);
});
