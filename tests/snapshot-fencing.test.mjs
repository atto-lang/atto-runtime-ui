import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {displayNode, validateSnapshot, MAX_DEPTH} from '../web/snapshot-policy.mjs';

const source = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8')
  .replace(/^import \{ displayNode, validateSnapshot, MAX_DEPTH \} from '\.\/snapshot-policy\.mjs';\n/, '');
function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return {promise, resolve};
}
function harness({csrf = 'valid-opaque-csrf-token'} = {}) {
  const elements = new Map();
  function element() {
    return {
      textContent: '', hidden: true, disabled: false, children: [], handlers: {},
      addEventListener(type, callback) { this.handlers[type] = callback; },
      setAttribute() {},
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = children; },
    };
  }
  for (const id of ['#tree', '#details', '#state', '#meta', '#error', '#refresh']) elements.set(id, element());
  const pendingGets = [];
  const pendingPosts = [];
  const context = {
    document: {
      querySelector: selector => selector === 'meta[name="csrf-token"]'
        ? csrf ? {content: csrf} : null : elements.get(selector),
      createElement: element,
      createDocumentFragment: element,
    },
    AbortController, TextDecoder, displayNode, validateSnapshot, MAX_DEPTH,
    fetch(url, options = {}) {
      const d = deferred();
      d.url = url;
      d.options = options;
      if (options.method === 'POST') pendingPosts.push(d);
      else pendingGets.push(d);
      return d.promise;
    },
  };
  runInNewContext(source, context, {filename: 'web/app.js'});
  return {context, elements, pendingGets, pendingPosts};
}
const TS = '2026-10-30T20:00:00Z';
function snapshot(id = 'initial', status = 'complete') {
  return {
    schemaVersion: 1, snapshotId: id, status, startedAt: TS, finishedAt: TS,
    supervisors: status === 'pending' ? [] : [{id: 'root', parentId: null, status: 'running', generation: 1, observedAt: TS}],
    actors: [], missingSupervisorIds: [], warnings: [],
  };
}
function complete(deferredRequest, body, status = 200) {
  deferredRequest.resolve({ok: status < 400, status, json: async () => body});
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('late initial GET cannot overwrite a later snapshot or error', async () => {
  const h = harness();
  assert.equal(h.pendingGets.length, 1);
  const newer = h.context.load();
  complete(h.pendingGets[1], snapshot('NEW'));
  await newer;
  assert.match(h.elements.get('#meta').textContent, /NEW/);
  complete(h.pendingGets[0], snapshot('OLD', 'partial'));
  await tick();
  assert.match(h.elements.get('#meta').textContent, /NEW/);
  assert.equal(h.elements.get('#error').hidden, true);
});

test('refresh invalidates GET and uses POST receipt identity (not stale last-completed tree)', async () => {
  const h = harness();
  const clicked = h.elements.get('#refresh').handlers.click();
  assert.equal(h.elements.get('#refresh').disabled, true);
  assert.equal(h.pendingPosts[0].options.headers['X-CSRF-Token'], 'valid-opaque-csrf-token');
  complete(h.pendingGets[0], snapshot('STALE'));
  await tick();
  assert.equal(h.elements.get('#state').textContent, 'Refreshing…');
  complete(h.pendingPosts[0], {snapshotId: 'FRESH'}, 202);
  await tick();
  assert.equal(h.pendingGets[1].url, '/api/v1/supervision/snapshots/FRESH');
  complete(h.pendingGets[1], snapshot('FRESH'));
  await clicked;
  assert.match(h.elements.get('#meta').textContent, /FRESH/);
  assert.equal(h.elements.get('#refresh').disabled, false);
});

test('malformed duplicate snapshot fails closed and clears previously selected tree', async () => {
  const h = harness();
  const current = h.context.load();
  complete(h.pendingGets[1], snapshot('VALID'));
  await current;
  assert.equal(h.elements.get('#tree').children.length, 1);
  const invalid = h.context.load();
  const bad = snapshot('INVALID');
  bad.actors.push({id: 'root', supervisorId: 'root', status: 'running', generation: 1, observedAt: TS});
  complete(h.pendingGets[2], bad);
  await invalid;
  assert.equal(h.elements.get('#state').textContent, 'Unavailable');
  assert.match(h.elements.get('#error').textContent, /duplicate/i);
  assert.equal(h.elements.get('#tree').children.length, 0);
  assert.equal(h.elements.get('#meta').textContent, '');
});

test('failed snapshot POST exits refreshing and cannot publish stale GET', async () => {
  const h = harness();
  const clicked = h.elements.get('#refresh').handlers.click();
  complete(h.pendingGets[0], snapshot('STALE'));
  complete(h.pendingPosts[0], null, 503);
  await clicked;
  assert.equal(h.elements.get('#state').textContent, 'Unavailable');
  assert.match(h.elements.get('#error').textContent, /HTTP 503/);
  assert.equal(h.elements.get('#refresh').disabled, false);
  assert.equal(h.elements.get('#meta').textContent, '');
});

test('double click cannot launch multiple snapshot creations', async () => {
  const h = harness();
  const a = h.elements.get('#refresh').handlers.click();
  await h.elements.get('#refresh').handlers.click();
  assert.equal(h.pendingPosts.length, 1);
  complete(h.pendingPosts[0], {snapshotId: 'N'}, 202);
  await tick();
  complete(h.pendingGets[1], snapshot('N'));
  await a;
});

test('CSRF token is mandatory, no snapshot POST when absent', async () => {
  const h = harness({csrf: null});
  await h.elements.get('#refresh').handlers.click();
  assert.equal(h.pendingPosts.length, 0);
  assert.match(h.elements.get('#error').textContent, /CSRF token/);
});

test('snapshot result cannot swap identities after accepted receipt', async () => {
  const h = harness();
  const clicked = h.elements.get('#refresh').handlers.click();
  complete(h.pendingPosts[0], {snapshotId: 'requested'}, 202);
  await tick();
  complete(h.pendingGets[1], snapshot('other'));
  await clicked;
  assert.equal(h.elements.get('#state').textContent, 'Unavailable');
  assert.match(h.elements.get('#error').textContent, /identity mismatch/);
});

test('pending result never displays an apparently complete tree', async () => {
  const h = harness();
  const clicked = h.elements.get('#refresh').handlers.click();
  complete(h.pendingPosts[0], {snapshotId: 'running'}, 202);
  await tick();
  complete(h.pendingGets[1], snapshot('running', 'pending'));
  await clicked;
  assert.equal(h.elements.get('#state').textContent, 'Snapshot pending');
  assert.equal(h.elements.get('#tree').children.length, 1); // empty fragment
});

test('declared oversized response rejected without parsing JSON', async () => {
  const h = harness();
  const loaded = h.context.load();
  h.pendingGets[1].resolve({ok: true, status: 200,
    headers: {get: k => k === 'content-length' ? '99999999' : 'application/json'},
    json: async () => { throw Error('should not parse'); }});
  await loaded;
  assert.match(h.elements.get('#error').textContent, /byte limit/);
});

test('stream exceeding 1 MiB aborts before JSON parse', async () => {
  const h = harness();
  const loaded = h.context.load();
  let cancelled = false;
  h.pendingGets[1].resolve({ok: true, status: 200,
    headers: {get: () => null},
    body: {getReader: () => ({
      read: async () => ({done: false, value: new Uint8Array(1024 * 1024 + 1)}),
      cancel: async () => { cancelled = true; },
    })},
  });
  await loaded;
  assert.equal(cancelled, true);
  assert.match(h.elements.get('#error').textContent, /byte limit/);
});

test('unexpected content type is rejected before parsing', async () => {
  const h = harness();
  const loaded = h.context.load();
  h.pendingGets[1].resolve({ok:true,status:200,
    headers:{get:key => key === 'content-type' ? 'text/html' : null},
    json:async() => snapshot('BAD'),
  });
  await loaded;
  assert.match(h.elements.get('#error').textContent, /content type/);
});
