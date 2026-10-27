import { displayNode } from './snapshot-policy.mjs';
const tree = document.querySelector('#tree');
const details = document.querySelector('#details');
const state = document.querySelector('#state');
const meta = document.querySelector('#meta');
const error = document.querySelector('#error');
const refresh = document.querySelector('#refresh');
const MAX_NODES = 10000;
function showError(message) { error.textContent = message; error.hidden = false; }
function clearError() { error.hidden = true; error.textContent = ''; }
function safeId(value) { return typeof value === 'string' && value.length > 0 && value.length <= 256; }
function render(snapshot) {
  if (!snapshot || snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.supervisors) || !Array.isArray(snapshot.actors)) throw Error('Unsupported snapshot schema');
  const {supervisors, actors} = snapshot;
  if (supervisors.length + actors.length > MAX_NODES) throw Error('Snapshot exceeds UI node limit');
  const ids = new Set();
  for (const n of [...supervisors, ...actors]) {
    if (!safeId(n.id) || ids.has(n.id)) throw Error('Invalid or duplicate runtime node ID');
    ids.add(n.id);
  }
  const supervisorIds = new Set(supervisors.map(s => s.id));
  for (const s of supervisors) if (s.parentId != null && !supervisorIds.has(s.parentId)) throw Error('Orphan supervisor');
  for (const a of actors) if (!supervisorIds.has(a.supervisorId)) throw Error('Orphan actor');
  const byParent = new Map();
  for (const s of supervisors) {
    const key = s.parentId;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push({kind:'supervisor', node:s});
  }
  for (const a of actors) {
    if (!byParent.has(a.supervisorId)) byParent.set(a.supervisorId, []);
    byParent.get(a.supervisorId).push({kind:'actor', node:a});
  }
  const roots = byParent.get(null) || [];
  if (supervisors.length && !roots.length) throw Error('Missing root supervisor');
  const visited = new Set();
  const fragment = document.createDocumentFragment();
  function append(entry, container, depth) {
    if (depth > 64) throw Error('Supervision depth exceeded');
    const {kind,node} = entry;
    if (visited.has(node.id)) throw Error('Cycle or duplicate supervisor edge');
    visited.add(node.id);
    const row = document.createElement('button');
    row.type = 'button'; row.className = 'node'; row.setAttribute('role','treeitem');
    row.textContent = (kind === 'supervisor' ? '▣ ' : '◉ ') + node.id;
    const badge = document.createElement('span'); badge.className='badge';
    badge.textContent = node.status || 'unknown'; row.append(badge);
    row.addEventListener('click', () => { details.textContent = JSON.stringify(displayNode(kind,node), null, 2); });
    container.append(row);
    if (kind === 'supervisor') {
      const children = byParent.get(node.id) || [];
      if (children.length) {
        const group = document.createElement('div'); group.className='children'; group.setAttribute('role','group');
        container.append(group);
        for (const child of children) append(child,group,depth+1);
      }
    }
  }
  for (const root of roots) append(root,fragment,0);
  if (visited.size !== ids.size) throw Error('Unreachable nodes in supervision tree');
  tree.replaceChildren(fragment);
  const partial = snapshot.status !== 'complete';
  state.textContent = partial ? '⚠ Partial snapshot' : '● Snapshot complete';
  meta.textContent = supervisors.length + ' supervisors · ' + actors.length + ' actors · ' + (snapshot.finishedAt || 'pending');
  if (partial) showError('Some nodes may be unavailable. Do not interpret missing actors as healthy.');
}
let latestSnapshotRequest = 0;
async function load() {
  const requestId = ++latestSnapshotRequest;
  try {
    const response = await fetch('/api/v1/supervision/tree',{credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}});
    if (requestId !== latestSnapshotRequest) return;
    if (!response.ok) throw Error('Snapshot request failed: HTTP '+response.status);
    const data = await response.json();
    if (requestId !== latestSnapshotRequest) return;
    clearError(); render(data);
  } catch(e) {
    if (requestId !== latestSnapshotRequest) return;
    state.textContent='Unavailable'; showError(e.message || 'Unable to load snapshot');
  }
}
refresh.addEventListener('click',async()=>{
  // A pending initial GET must not overwrite a newer user-requested snapshot.
  ++latestSnapshotRequest;
  refresh.disabled=true;
  state.textContent='Refreshing…';
  try {
    const response = await fetch('/api/v1/supervision/snapshots',{method:'POST',credentials:'same-origin',headers:{Accept:'application/json'}});
    if(!response.ok) throw Error('Snapshot creation failed: HTTP '+response.status);
    await load();
  } catch(e) {
    // A failed POST must not leave the UI in its optimistic Refreshing state.
    state.textContent='Unavailable';
    showError(e.message || 'Unable to request snapshot');
  } finally { refresh.disabled=false; }
});
load();
