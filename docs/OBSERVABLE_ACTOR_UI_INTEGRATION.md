# Runtime UI + ObservableActor<E> integration boundary (v1)

**Status: design / frontend-contract only.** This repository does not contain a native Oreslang HTTP server, authenticated runtime CONTROL bridge or executing source-language ObservableActor. Do not infer native runtime evidence from JavaScript tests.

Related draft contracts:
- [oreslang-common-source PR #200](https://github.com/ores-truffle-oreslang/oreslang-common-source/pull/200): actor-only `ObservableActor<E: Sendable>` with publish/subscribe hooks, bounded lease policies and per-incarnation sequence identities. Source contract only, not compiler-executed.
- [oreslang-source.java PR #2345](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2345): Java host/runtime publisher-specific `ActorEventBus.subscribePublisher`, SHARED domain only; not the source-level trait. Its existing event sequence is per topic rather than per publisher.
- [runtime UI issue #1](https://github.com/ores-truffle-oreslang/oreslang-runtime-ui/issues/1): runtime authorization and partial-result requirements.

## Authority separation

The supervisor registry is authoritative for supervision edges, child lifecycle, budgeted CONTROL snapshots and actor generation. Ordinary actor event publications, UI users, and observer callbacks cannot forge or intercept CONTROL messages. Spawn ancestry (`spawnedBy`) is independent of supervision ancestry (`parentId`).

An eventual native `RuntimeObservationBroker` actor should possess a revocable, nonforgeable, tenant- and subtree-bound **observation grant**. It obtains supervisor snapshots using an independent runtime-only capability, and optionally subscribes to typed actor lifecycle hints via `ObservableActor<E>` when the source contract is implemented. A known `ActorRef`, an actor ID, a topic name, or ActorGroup membership alone does **not** authorize observing another actor.

`on_observed_event` runs only on the broker's own actor turn. Neither publisher callbacks nor broker callbacks execute while holding registry, lifecycle, mailbox, channel or CONTROL locks. Observer failures use normal actor supervision semantics; observation must never consume the supervisor's reserved CONTROL headroom.

The HTTP/SSE gateway only receives **sanitized public projections**, never raw guest values or actor state. No client can subscribe directly to arbitrary actors, read sealed state, access mailbox payloads, see exception text or stack traces, mint grants, or change actor lifetime. Server-side authentication, authorization, tenant separation, revocation, and limits remain mandatory even if the browser applies an allowlist.

## Proposed public event envelope (not implemented)

Versioned lifecycle events may expose only `schemaVersion`, `streamId`, `eventId`, `snapshotId`, `publisherId`, `publisherGeneration`, `publisherSequence`, `observedAt`, `eventKind`, `nodeId`, `nodeGeneration` and `status`. `eventKind` must be a narrow enum (actor started/stopped/failed, supervisor changed, observation gap). Values are opaque; arbitrary `data`, `payload`, `state`, `secret`, `stack` and `credentials` fields may never be forwarded.

Sequence is monotonic **per publisher incarnation**. A gap, duplicate, rollback, unauthorized publisher, generation change, missing grant, schema mismatch, replay beyond the bounded window, or stream epoch change must invalidate the displayed delta view and trigger an authorized fresh snapshot, never fabricate health. Observation is not a globally atomic runtime image.

Prefer bounded `LATEST` coalescing with explicit gap-to-resnapshot for UI hints; unbounded RELIABLE fanout would allow slow browsers to stall publishers. Independent per-subscriber caps must bound event bytes, queues, reconnection attempts, pending requests, processing budgets and subscriptions. Each reconnect and Last-Event-ID replay must be reauthorized for the current tenant, subtree, grant epoch and publisher incarnation. Do not launch SSE consumption before the native broker proves these gates.

## Hardened snapshot API v1

- `GET /api/v1/supervision/tree`: authenticated last-completed snapshot, read-only. On malformed/unavailable output, the browser removes stale content.
- `POST /api/v1/supervision/snapshots`: privileged, rate-limited, CSRF-checked fresh request, returning JSON `{ "snapshotId": "opaque" }`. The browser sends a **server-provisioned** `X-CSRF-Token`. The server must independently bind the token to a session and check Origin/Referer. There is no checked-in CSRF token; without server injection, refresh is disabled by failure.
- `GET /api/v1/supervision/snapshots/{id}`: status/result for exactly that snapshot, with matching `snapshotId`. Do not substitute the last-completed tree. `pending` has no observed nodes; `partial` must preserve missing/unresponsive state; `complete` must not claim missing or uncertain nodes are healthy. The browser performs a single status GET without unbounded polling.
- The protocol requires v1 `schemaVersion`, bounded `snapshotId`, `startedAt`, explicit `status` (`pending|partial|complete`), `supervisors`/`actors`, `finishedAt` for nonpending results, and for every node opaque ID, nonnegative safe-integer generation, recognized status and UTC `observedAt`. Missing supervisor IDs are enumerated separately. Exactly one root is required for nonpending results; cycles, duplicate IDs, orphan edges and invalid status cause rejection.
- Browser cap: **1 MiB uncompressed JSON**, 10,000 nodes, 64 levels, 128 warnings, bounded strings. Independently enforce tighter server-side CPU, depth, fanout, time and network budgets. Cache-Control no-store; application/json; same-origin credentials. Browser validation is not a security boundary against a compromised server.

## Evidence and promotion

1. Exact-head Node tests for malformed, oversized, stale, pending, duplicate, cyclic, orphan, CSRF and generation-fence cases (source-local evidence only).
2. Real native server/protocol and runtime-private CONTROL admission tests on Java/GraalVM and LLVM, with forged guest CONTROL, foreign tenant, concurrent actor exit, expiration, duplicate generation, timeouts and bounded partial results.
3. Source-language `ObservableActor` typed `Sendable` checks, per-publisher sequence and capability validation, broker actor-turn delivery, memory reclamation and cross-isolate copy conformance. Reuse common-source PR #200 rather than declaring a second incompatible trait in this UI repo.
4. Exact-source integration and stress tests for browser disconnect/reconnect, malformed event frames, slow clients, dropped deltas, identity rollover, output redaction and shutdown; then .NET/Wasm/Forge parity independently.
5. A CI job with `steps=null` or no allocated runner **does not count as executed evidence**. Do not mirror private source to an external organization without security/provenance authorization. Leave the PR in draft until executable source-org or approved private-runner evidence is available.
