import { displayNode, validateSnapshot, MAX_DEPTH } from './snapshot-policy.mjs';
const tree = document.querySelector('#tree');
const details = document.querySelector('#details');
const state = document.querySelector('#state');
const meta = document.querySelector('#meta');
const error = document.querySelector('#error');
const refresh = document.querySelector('#refresh');
const MAX_RESPONSE_BYTES = 1024 * 1024;
const DEFAULT_GET = '/api/v1/supervision/tree';
function showError(message) { error.textContent = message; error.hidden = false; }
function clearError() { error.hidden = true; error.textContent = ''; }
function clearSnapshot() {
  globalThis.clearTimeout?.(staleTimer);
  tree.replaceChildren();
  details.textContent = 'Select a supervisor or actor.';
  meta.textContent = '';
}
function render(untrusted, expectedSnapshotId = null) {
  const snapshot = validateSnapshot(untrusted);
  if (expectedSnapshotId !== null && snapshot.snapshotId !== expectedSnapshotId) {
    throw Error('Snapshot identity mismatch');
  }
  const { supervisors, actors } = snapshot;
  globalThis.clearTimeout?.(staleTimer);
  staleTimer = globalThis.setTimeout?.(() => {
    state.textContent = '⚠ Stale observation';
    showError('This observation is over 5 seconds old. Refresh to observe the runtime again.');
  }, Math.max(0, 5000 - (Date.now() - Date.parse(snapshot.finishedAt || snapshot.startedAt))));
  const byParent = new Map();
  for (const s of supervisors) {
    if (!byParent.has(s.parentId)) byParent.set(s.parentId, []);
    byParent.get(s.parentId).push({ kind: 'supervisor', node: s });
  }
  for (const a of actors) {
    if (!byParent.has(a.supervisorId)) byParent.set(a.supervisorId, []);
    byParent.get(a.supervisorId).push({ kind: 'actor', node: a });
  }
  const fragment = document.createDocumentFragment();
  function append(entry, container, depth) {
    if (depth > MAX_DEPTH) throw Error('Supervision depth exceeded');
    const {kind, node} = entry;
    const row = document.createElement('button');
    row.type = 'button'; row.className = 'node'; row.setAttribute('role', 'treeitem');
    row.textContent = (kind === 'supervisor' ? '▣ ' : '◉ ') + node.id;
    const badge = document.createElement('span'); badge.className = 'badge';
    badge.textContent = node.status; row.append(badge);
    if (kind === 'actor') {
      const counts = document.createElement('span');
      counts.textContent = ' · queue ' + (node.mailboxDepth ?? 'unknown') +
        (node.kind === 'unmanaged-supervision-unknown' ? ' · supervision unknown' : '');
      row.append(counts);
    }
    row.addEventListener('click', () => { details.textContent = JSON.stringify(displayNode(kind, node), null, 2); });
    container.append(row);
    if (kind === 'supervisor') {
      const children = byParent.get(node.id) || [];
      if (children.length) {
        const group = document.createElement('div'); group.className = 'children'; group.setAttribute('role', 'group');
        container.append(group);
        for (const child of children) append(child, group, depth + 1);
      }
    }
  }
  for (const root of byParent.get(null) || []) append(root, fragment, 0);
  tree.replaceChildren(fragment);
  if (snapshot.status === 'complete') {
    state.textContent = '● Snapshot complete';
  } else if (snapshot.status === 'pending') {
    state.textContent = 'Snapshot pending';
  } else {
    state.textContent = '⚠ Partial snapshot';
    showError('Some nodes may be unavailable. Do not interpret missing actors as healthy.');
  }
  meta.textContent = supervisors.length + ' supervisors · ' + actors.length + ' actors · ' +
    (snapshot.finishedAt || 'pending') + ' · ' + snapshot.snapshotId;
  return snapshot.status;
}
async function readJsonBounded(response) {
  const type = response.headers?.get?.('content-type');
  if (type && !/^application\/(?:json|[a-z0-9.+-]+\+json)(?:\s*;|\s*$)/i.test(type)) {
    throw Error('Unexpected API response content type');
  }
  const declared = response.headers?.get?.('content-length');
  if (declared != null && declared !== '') {
    if (!/^\d+$/.test(declared) || Number(declared) > MAX_RESPONSE_BYTES) throw Error('API response exceeds byte limit');
  }
  if (!response.body?.getReader) return response.json(); // Node test harness / non-streaming response.
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', {fatal: true});
  let bytes = 0;
  let result = '';
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) throw Error('API response exceeds byte limit');
      result += decoder.decode(value, {stream: true});
    }
    result += decoder.decode();
    return JSON.parse(result);
  } finally {
    reader.cancel().catch(() => {});
  }
}
let staleTimer = null;
let latestRequest = 0;
let currentGet = null;
async function load(url = DEFAULT_GET, expectedSnapshotId = null) {
  const request = ++latestRequest;
  currentGet?.abort();
  const controller = new AbortController();
  currentGet = controller;
  try {
    const response = await fetch(url, {
      credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
      headers: {Accept: 'application/json'},
    });
    if (request !== latestRequest) return;
    if (!response.ok) throw Error('Snapshot request failed: HTTP ' + response.status);
    const data = await readJsonBounded(response);
    if (request !== latestRequest) return;
    const status = render(data, expectedSnapshotId);
    clearError();
    if (status === 'partial') showError('Some nodes may be unavailable. Do not interpret missing actors as healthy.');
    return status;
  } catch (e) {
    if (request !== latestRequest) return;
    clearSnapshot();
    state.textContent = 'Unavailable';
    showError(e.message || 'Unable to load snapshot');
  } finally {
    if (currentGet === controller) currentGet = null;
  }
}
refresh.addEventListener('click', async () => {
  if (refresh.disabled) return;
  ++latestRequest;
  currentGet?.abort();
  refresh.disabled = true;
  clearSnapshot();
  clearError();
  state.textContent = 'Refreshing…';
  try {
    if (document.querySelector('meta[name="observation-mode"]')?.content === 'read-only') {
      await load();
      return;
    }
    const token = document.querySelector('meta[name="csrf-token"]')?.content;
    if (typeof token !== 'string' || token.length < 16 || token.length > 512) {
      throw Error('Snapshot request unavailable: missing CSRF token');
    }
    const response = await fetch('/api/v1/supervision/snapshots', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: {Accept: 'application/json', 'X-CSRF-Token': token},
    });
    if (!response.ok) throw Error('Snapshot creation failed: HTTP ' + response.status);
    const receipt = await readJsonBounded(response);
    const id = receipt?.snapshotId;
    if (typeof id !== 'string' || id.length === 0 || id.length > 256 || /[\u0000-\u001f\u007f]/.test(id)) {
      throw Error('Snapshot creation did not return an identity');
    }
    await load('/api/v1/supervision/snapshots/' + encodeURIComponent(id), id);
  } catch (e) {
    clearSnapshot();
    state.textContent = 'Unavailable';
    showError(e.message || 'Unable to request snapshot');
  } finally {
    refresh.disabled = false;
  }
});
load();
