import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {displayNode} from '../web/snapshot-policy.mjs';

const source = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8')
  .replace(/^import \{ displayNode \} from '\.\/snapshot-policy\.mjs';\n/, '');
function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return {promise, resolve};
}
function harness() {
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
  for (const id of ['#tree','#details','#state','#meta','#error','#refresh'])
    elements.set(id, element());
  const pendingGets = [];
  const pendingPosts = [];
  const context = {
    document: {
      querySelector: selector => elements.get(selector),
      createElement: element,
      createDocumentFragment: element,
    },
    displayNode,
    fetch(url, options = {}) {
      const d = deferred();
      if (options.method === 'POST') pendingPosts.push(d);
      else pendingGets.push(d);
      return d.promise;
    },
  };
  runInNewContext(source, context, {filename:'web/app.js'});
  return {context, elements, pendingGets, pendingPosts};
}
function snapshot(finishedAt, status = 'complete') {
  return {schemaVersion:1,status,finishedAt,
    supervisors:[{id:'root',parentId:null,status:'running'}],actors:[]};
}
function complete(deferredRequest, body) {
  deferredRequest.resolve({ok:true,status:200,json:async()=>body});
}

test('late initial GET cannot overwrite newer snapshot or reinstate an old error', async () => {
  const h = harness();
  assert.equal(h.pendingGets.length,1);
  const newer = h.context.load();
  assert.equal(h.pendingGets.length,2);
  complete(h.pendingGets[1],snapshot('NEW'));
  await newer;
  assert.match(h.elements.get('#meta').textContent,/NEW/);
  complete(h.pendingGets[0],snapshot('OLD','partial'));
  await new Promise(resolve=>setImmediate(resolve));
  assert.match(h.elements.get('#meta').textContent,/NEW/);
  assert.equal(h.elements.get('#error').hidden,true);
});

test('refresh invalidates an in-flight GET before its POST completes', async () => {
  const h = harness();
  const clicked = h.elements.get('#refresh').handlers.click();
  assert.equal(h.elements.get('#refresh').disabled,true);
  complete(h.pendingGets[0],snapshot('STALE'));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.elements.get('#state').textContent,'Refreshing…');
  h.pendingPosts[0].resolve({ok:true,status:202});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.pendingGets.length,2);
  complete(h.pendingGets[1],snapshot('AFTER_REFRESH'));
  await clicked;
  assert.match(h.elements.get('#meta').textContent,/AFTER_REFRESH/);
  assert.equal(h.elements.get('#refresh').disabled,false);
});

test('invalid duplicate snapshot IDs fail closed without replacing current tree', async () => {
  const h = harness();
  const current = h.context.load();
  complete(h.pendingGets[1],snapshot('VALID'));
  await current;
  const before = h.elements.get('#tree').children[0];
  const invalid = h.context.load();
  const bad = snapshot('INVALID');
  bad.actors.push({id:'root',supervisorId:'root',status:'running'});
  complete(h.pendingGets[2],bad);
  await invalid;
  assert.equal(h.elements.get('#state').textContent,'Unavailable');
  assert.match(h.elements.get('#error').textContent,/duplicate/i);
  assert.equal(h.elements.get('#tree').children[0],before);
});

test('failed snapshot POST exits refreshing state and never publishes stale GET', async () => {
  const h = harness();
  const clicked = h.elements.get('#refresh').handlers.click();
  complete(h.pendingGets[0],snapshot('STALE'));
  h.pendingPosts[0].resolve({ok:false,status:503});
  await clicked;
  assert.equal(h.elements.get('#state').textContent,'Unavailable');
  assert.match(h.elements.get('#error').textContent,/HTTP 503/);
  assert.equal(h.elements.get('#refresh').disabled,false);
  assert.equal(h.elements.get('#meta').textContent,'');
});
