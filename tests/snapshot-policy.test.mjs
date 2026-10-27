import test from 'node:test';
import assert from 'node:assert/strict';
import { displayNode } from '../web/snapshot-policy.mjs';

test('actor observation excludes extra runtime state, even when nested or non-enumerable', () => {
  const actor = {
    id: 'A', supervisorId: 'S', kind: 'private', status: 'running',
    mailboxDepth: 2, state: { token: 'secret' }, mailboxPayload: 'private-message',
    accessToken: 'do-not-reflect', stackTrace: 'secret',
  };
  Object.defineProperty(actor, 'credentials', { value: 'hidden', enumerable: false });
  const details = displayNode('actor', actor);
  assert.deepEqual(details, {
    kind: 'actor', id: 'A', supervisorId: 'S', status: 'running', actorKind: 'private',
    mailboxDepth: 2,
  });
  const serialized = JSON.stringify(details);
  for (const value of ['secret', 'private-message', 'do-not-reflect', 'stackTrace', 'credentials']) {
    assert.ok(!serialized.includes(value));
  }
});

test('supervisor observation preserves only public structural fields', () => {
  assert.deepEqual(displayNode('supervisor', {
    id: 'Root', parentId: null, status: 'partial', generation: 4,
    observedAt: '2026-10-27T15:00:00Z', secretState: 'ignored', droppedCONTROL: { raw: 'hidden' },
  }), {
    kind: 'supervisor', id: 'Root', parentId: null, status: 'partial',
    generation: 4, observedAt: '2026-10-27T15:00:00Z',
  });
});

test('malformed or oversized details are bounded and invalid metadata omitted', () => {
  const result = displayNode('actor', { id: 'x'.repeat(400), generation: -1, mailboxDepth: Infinity, status: { token: 'x' } });
  assert.equal(result.id.length, 257);
  assert.equal(result.generation, undefined);
  assert.equal(result.mailboxDepth, undefined);
  assert.equal(result.status, undefined);
  assert.throws(() => displayNode('arbitrary', {}), /Invalid runtime node/);
  assert.throws(() => displayNode('actor', null), /Invalid runtime node/);
});

test('prototype-inherited fields are never trusted observation metadata', () => {
  const source = Object.create({ id: 'forged', status: 'running', state: 'secret' });
  source.supervisorId = 'Root';
  assert.deepEqual(displayNode('actor', source), { kind: 'actor', supervisorId: 'Root' });
});

test('accessor properties are never invoked, including runtime kind', () => {
  let reads = 0;
  const actor = { id: 'A', supervisorId: 'Root', mailboxDepth: 3 };
  for (const field of ['status', 'kind', 'spawnedBy']) {
    Object.defineProperty(actor, field, { enumerable: true, get() { reads++; throw new Error('executed secret getter'); } });
  }
  assert.deepEqual(displayNode('actor', actor), {
    kind: 'actor', id: 'A', supervisorId: 'Root', mailboxDepth: 3,
  });
  assert.equal(reads, 0);
});

test('prototype names are invalid node kinds', () => {
  for (const kind of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    assert.throws(() => displayNode(kind, { id: 'A' }), /Invalid runtime node/);
  }
});

test('own plain data descriptors and optional nulls remain intact', () => {
  const supervisor = Object.create(null);
  Object.defineProperty(supervisor, 'id', { value: 'S' });
  Object.defineProperty(supervisor, 'parentId', { value: null });
  assert.deepEqual(displayNode('supervisor', supervisor), { kind: 'supervisor', id: 'S', parentId: null });
});
