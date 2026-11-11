# RuntimeObservationBroker: host observation boundary

**Status: executable Node.js host broker only.** No native Oreslang CONTROL snapshot provider, authenticated HTTP service, or full ObservableActor source-language implementation is claimed by this repository.

The module `server/runtime-observation-broker.mjs` exposes `createRuntimeObservationBroker({source, monotonicMs})`. Trusted runtime bootstrapping retains the returned `authority`; authenticated request handlers receive only `broker`. Never pass authority or grant objects to actors, browsers, cookies, URLs, logs, or different isolates. Grants are unforgeable JavaScript object identities within this process, **not** network bearer tokens.

## Native source contract

Only a trusted, privileged runtime implementation may supply:

```js
source.snapshot({
  tenantId, scopeRootId, scopeGeneration,
  maxNodes, maxDepth, deadlineMs, signal
})
```

The adapter must independently prove supervisor CONTROL authority, enforce the authorized tenant and subtree, honor generation and timeout fencing, bound native fanout/memory, and return honest pending/partial/complete snapshots. `signal` conveys cancellation intent, not physical completion. **No such native adapter has been implemented yet.** Java currently exposes host supervisor hierarchy and group enumeration but not this authenticated snapshot provider. Do not substitute ordinary ActorGroup membership, actor IDs, an ActorRef, or direct actor state.

A native snapshot must include `tenantId`, `scopeRootId`, `scopeGeneration`, `schemaVersion`, `snapshotId`, `status`, `startedAt`, `finishedAt` for completed/partial, `supervisors`, `actors` and optional `missingSupervisorIds`. Every node needs ID, generation, recognized lifecycle status and UTC `observedAt`. The observed subtree root has `parentId: null`. The broker validates scope identity and root incarnation, rejects malformed graph reports, copies only approved fields and drops all raw warnings and arbitrary private properties.

## Privileged bootstrap example

```js
const {authority, broker} = createRuntimeObservationBroker({source});
const grant = authority.issueGrant({
  subject: authenticatedSessionObject, tenantId: 'opaque-tenant',
  scopeRootId: 'opaque-supervisor', scopeGeneration: 7,
  ttlMs: 10000, maxNodes: 200, maxDepth: 8
});
const result = await broker.readSnapshot({
  subject: authenticatedSessionObject, grant,
  maxNodes: 200, maxDepth: 8, timeoutMs: 250
});
```

The caller's `subject` is an already-authenticated server-side session **object identity**, not a client-supplied session string. The native runtime is responsible for issuing scope permissions; the bootstrap must revoke grants after logout, tenant reassignment, supervisor incarnation rollover, or changing authorizations. No HTTP route can mint observation grants.

## Bounded, fail-closed behavior

- At most 8 active snapshot source calls globally and one per grant.
- Maximum grant lifetime 60 seconds, per-call deadline 5 seconds, 10,000 nodes, 64 levels, and 1 MiB projected JSON. These are *additional* to native runtime limits.
- `DENIED` for forged, expired, revoked or mismatched session grants; `BUSY` on quota exhaustion; `DEADLINE_EXCEEDED` on elapsed time; `INVALID_SNAPSHOT` on malformed source output; `OBSERVATION_UNAVAILABLE` hides private source errors.
- Revocation and broker shutdown abort any pending read. Even if a native adapter ignores cancellation, its concurrency slot remains reserved until its underlying Promise settles; a hung adapter causes bounded fail-closed unavailability instead of unchecked background work.
- Grant/tenant/subtree/incarnation identities are checked before and after the asynchronous source call. Disclosed data is a frozen allowlisted projection, not runtime heap objects.

## Release gates

Run `npm test` on Node 22+ for the browser and broker adversarial suites. This establishes only JavaScript contract execution, not native Oreslang guest or CONTROL conformance. No browser direct actor subscription, SSE event relay, HTTP authentication, CSRF, CSP or production network server is provided here. Implement the native read-only adapter, HTTP session boundary, exact-head JDK25/GraalVM tests, LLVM execution and remaining backend parity before any live exposure.

The intended typed publisher contracts remain in [common-source PR #200](https://github.com/ores-truffle-oreslang/oreslang-common-source/pull/200) and [Java PR #2345](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2345). Do not duplicate the ObservableActor trait. Any source Actions jobs with no executed steps are still unverified. Do not export private source to another organization without security/provenance approval.

## Live Java adapter integration

`live-server.mjs` now connects the broker to the real Java runtime registry using
`integration/InspectorHost.java`. See `integration/README.md` for executed local
scope and limits. This supplies the local embedding observation path; distributed
reserved CONTROL fanout and remote user authentication remain separate work.
