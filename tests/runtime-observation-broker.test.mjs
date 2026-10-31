import test from 'node:test';
import assert from 'node:assert/strict';
import {createRuntimeObservationBroker, ObservationError} from '../server/runtime-observation-broker.mjs';

const TS = '2026-10-30T20:00:00Z';
function fixture(overrides = {}) {
  return {
    tenantId: 'tenant-a', scopeRootId: 'root', scopeGeneration: 3,
    schemaVersion: 1, snapshotId: 's-1', status: 'complete',
    startedAt: TS, finishedAt: TS,
    supervisors: [{id:'root',parentId:null,status:'running',generation:3,observedAt:TS}],
    actors: [{id:'a',supervisorId:'root',status:'running',generation:2,observedAt:TS,
      kind:'private',mailboxDepth:2,secret:'NEVER-LEAK'}],
    missingSupervisorIds: [], warnings: ['secret-from-control'], ...overrides,
  };
}
const subject = Object.freeze({session:'session-one'});
function harness(snapshot = () => fixture(), opts = {}) {
  let tick = 100;
  const source = {snapshot};
  const {authority, broker} = createRuntimeObservationBroker({source, monotonicMs: () => tick});
  const grant = authority.issueGrant({subject, tenantId:'tenant-a',scopeRootId:'root',
    scopeGeneration:3,ttlMs:1000, maxNodes:10,maxDepth:5,...opts});
  return {source, authority, broker, grant, advance(ms) {tick += ms;}};
}
const args = g => ({subject,grant:g,maxNodes:10,maxDepth:5,timeoutMs:100});
function code(c) {return e => e instanceof ObservationError && e.code === c;}
function deferred() {
  let resolve, reject;
  const promise = new Promise((a,b)=>{resolve=a;reject=b});
  return {promise,resolve,reject};
}
const settled = () => new Promise(resolve=>setImmediate(resolve));

test('real broker projects only safe metadata; arbitrary payloads and warnings never cross', async () => {
  const h = harness();
  const projected = await h.broker.readSnapshot(args(h.grant));
  assert.equal(projected.supervisors.length, 1);
  assert.equal(projected.actors[0].mailboxDepth, 2);
  assert.ok(!JSON.stringify(projected).includes('NEVER-LEAK'));
  assert.ok(!JSON.stringify(projected).includes('secret-from-control'));
  assert.ok(!Object.hasOwn(projected, 'tenantId'));
  assert.equal(Object.isFrozen(projected), true);
});
test('session identity binding denies copied session data, unknown tokens and invalid inputs', async () => {
  const h = harness();
  await assert.rejects(h.broker.readSnapshot({...args(h.grant),subject:{session:'session-one'}}),code('DENIED'));
  await assert.rejects(h.broker.readSnapshot({...args(h.grant),grant:Object.freeze({})}),code('DENIED'));
  await assert.rejects(h.broker.readSnapshot({...args(h.grant),maxNodes:11}),code('DENIED'));
  await assert.rejects(h.broker.readSnapshot({...args(h.grant),maxDepth:6}),code('DENIED'));
  await assert.rejects(h.broker.readSnapshot({...args(h.grant),timeoutMs:5001}),code('DENIED'));
});
test('tenant, subtree and incarnation substitution all reject', async () => {
  for (const mutate of [
    s => {s.tenantId='tenant-b'},
    s => {s.scopeRootId='other'},
    s => {s.scopeGeneration=4},
    s => {s.supervisors[0].generation=4},
    s => {s.supervisors[0].id='other'},
  ]) {
    const s=fixture();mutate(s);
    const h=harness(()=>s);
    await assert.rejects(h.broker.readSnapshot(args(h.grant)),code('INVALID_SNAPSHOT'));
  }
});
test('unknown status, incomplete complete result and orphan child all reject', async () => {
  for (const mutate of [
    s=>{s.status='healthy'},
    s=>{s.status='complete';s.missingSupervisorIds=['lost']},
    s=>{s.actors[0].supervisorId='other'},
  ]) {const s=fixture();mutate(s);const h=harness(()=>s);
    await assert.rejects(h.broker.readSnapshot(args(h.grant)),code('INVALID_SNAPSHOT'));}
});
test('runtime read errors cannot leak exception messages', async () => {
  const h=harness(()=>{throw Error('secret-key-in-internal-error')});
  await assert.rejects(h.broker.readSnapshot(args(h.grant)),code('OBSERVATION_UNAVAILABLE'));
});
test('missing trusted runtime source cannot silently yield success', () => {
  assert.throws(()=>createRuntimeObservationBroker({}),/Trusted supervisor/);
});
test('expiry invalidates a token before runtime access', async () => {
  let calls=0;const h=harness(()=>{calls++;return fixture()});h.advance(1000);
  await assert.rejects(h.broker.readSnapshot(args(h.grant)),code('DENIED'));
  assert.equal(calls,0);
});
test('revocation while native request is suspended blocks late results', async () => {
  const d=deferred();const h=harness(()=>d.promise);
  const pending=h.broker.readSnapshot(args(h.grant));await settled();
  assert.equal(h.authority.revoke(h.grant),true);
  await assert.rejects(pending,code('DENIED'));
  d.resolve(fixture());await settled();
  await assert.rejects(h.broker.readSnapshot(args(h.grant)),code('DENIED'));
});
test('multiple simultaneous calls on same grant fail closed', async () => {
  const d=deferred();const h=harness(()=>d.promise);
  const pending=h.broker.readSnapshot(args(h.grant));await settled();
  await assert.rejects(h.broker.readSnapshot(args(h.grant)),code('BUSY'));
  d.resolve(fixture());await pending;
  assert.equal((await h.broker.readSnapshot(args(h.grant))).status,'complete');
});
test('per-request cancellation does not accidentally release a running native quota', async () => {
  const d=deferred();const h=harness(()=>d.promise);
  const pending=h.broker.readSnapshot({...args(h.grant),timeoutMs:10});await settled();
  await assert.rejects(pending,code('DEADLINE_EXCEEDED'));
  await assert.rejects(h.broker.readSnapshot(args(h.grant)),code('BUSY'));
  d.resolve(fixture());await settled();
  assert.equal((await h.broker.readSnapshot(args(h.grant))).status,'complete');
});
test('global maximum active native requests bounds unrelated grants', async () => {
  const d=deferred();const h=harness(()=>d.promise);
  const grants=Array.from({length:9},()=>h.authority.issueGrant({subject,tenantId:'tenant-a',
    scopeRootId:'root',scopeGeneration:3,ttlMs:1000,maxNodes:10,maxDepth:5}));
  const reads=grants.slice(0,8).map(grant=>h.broker.readSnapshot(args(grant)));
  await settled();
  await assert.rejects(h.broker.readSnapshot(args(grants[8])),code('BUSY'));
  d.resolve(fixture());await Promise.all(reads);
});
test('an untrusted getter cannot execute during allowlist projection', async () => {
  let ran=0;const s=fixture();Object.defineProperty(s.actors[0],'kind',{
    get(){ran++;throw Error('forged getter')}, enumerable:true});
  const h=harness(()=>s);
  await assert.rejects(h.broker.readSnapshot(args(h.grant)),code('INVALID_SNAPSHOT'));
  assert.equal(ran,0);
});
test('oversized snapshot rejects without leaking raw body', async () => {
  const s=fixture({actors:Array.from({length:11},(_,i)=>({id:String(i),supervisorId:'root',
    generation:1,status:'running',observedAt:TS}))});
  const h=harness(()=>s);
  await assert.rejects(h.broker.readSnapshot(args(h.grant)),code('INVALID_SNAPSHOT'));
});
test('broker close aborts pending work and denies new grants and reads', async () => {
  const d=deferred();const h=harness(()=>d.promise);
  const pending=h.broker.readSnapshot(args(h.grant));await settled();
  h.authority.close();
  await assert.rejects(pending,code('DENIED'));
  await assert.rejects(h.broker.readSnapshot(args(h.grant)),code('DENIED'));
  assert.throws(()=>h.authority.issueGrant({subject,tenantId:'tenant-a',scopeRootId:'root',
    scopeGeneration:3,ttlMs:100}),code('DENIED'));
  d.resolve(fixture());await settled();
});
