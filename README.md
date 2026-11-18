# Oreslang Runtime UI

## Oreslang to AttoLang migration (2026-11-18)

**AttoLang** (formerly **Oreslang**) is the current public language identity. This `ores-truffle-oreslang/oreslang-runtime-ui` checkout retains old naming. Its AttoLang counterpart for new contributions is [atto-lang/atto-runtime-ui](https://github.com/atto-lang/atto-runtime-ui); this link **does not imply an in-place transfer, identical history, migrated issues/PRs or feature parity**. The old source and commands below remain useful as historical checkout documentation, not a guarantee of current language conformance.

**[atto-lang/atto-spec](https://github.com/atto-lang/atto-spec)** is the canonical language specification. The portable library source belongs in [atto-common-source](https://github.com/atto-lang/atto-common-source), shared positive/negative guest tests in [atto-platform-conformance](https://github.com/atto-lang/atto-platform-conformance), and compiler-specific implementations in `atto-source.*`. The language's current proposed direction includes canonical `.atto`, `snake_case`, `borrow!`/`take!`/`share!`/`copy!`/`copy!!`, [implicit borrow defaults](https://github.com/atto-lang/atto-spec/blob/main/language/implicit-argument-borrow-v1.md), [`define const` including permitted `os.read_env`](https://github.com/atto-lang/atto-spec/blob/main/language/file-module-const-v1.md), and [`<<<`/`>>>`/`ashr` shifts vs. `<<`/`>>` streams](https://github.com/atto-lang/atto-spec/blob/main/language/bitwise-and-stream-operators-v1.md). Check individual spec admission status; **a design target is not proof of execution**.

Keep legacy `.ores` fixtures, CLI/package/ABI names, and version-pinned commands where they document code still in this tree. Avoid Python in new AttoLang tooling/tests/CI; Rust support tools are preferred. Only claim cross-backend support with exact SHA/tree, target/toolchain, real executed positive and negative guest tests; report failed, unsupported and not-executed explicitly. Empty-step/host-only CI is not guest conformance.

A runtime supervision-tree inspector, with an Oreslang-native HTTP server as the target implementation.

## Status

Architecture and wire contract only. The repository was empty at initialization. No native Oreslang server or compiler-level supervisor declaration has been demonstrated yet.

## Supervision versus spawn lineage

An ordinary actor A spawning B does not promote A into a supervisor. B inherits A's supervisor unless a separately authorized supervisor explicitly admits B. A distinct `define supervisor S as ... end` (proposed source syntax) may be declared beside A and can launch B during S's admitted startup turn. A's spawn ancestry and S's supervision tree remain distinct.

```
RootSupervisor
├── S
│   ├── A
│   └── B
└── OtherSupervisor
    └── C
```

## Root snapshot protocol

The root sends an authenticated, runtime-reserved `SnapshotRequest(epoch, deadline, maxNodes, maxDepth)` down supervisor CONTROL edges. Each supervisor obtains an atomic local registry snapshot, fans out to its direct child supervisors, and merges bounded responses. Ordinary actor mailboxes MUST NOT receive privileged CONTROL packets.

A snapshot returns **observed**, **unresponsive**, and **terminated-during-snapshot** states. It is not a globally atomic image: every node carries observation timestamp and registry generation. Timeouts produce partial reports, never an invented healthy status.

- Supervisor records: opaque id, parent id, status, generation, policy, pending CONTROL, dropped CONTROL, observedAt.
- Actor records: opaque id, owning supervisor id, spawning actor id (if any), actor kind, lifecycle, mailbox depth, in-flight requests, observedAt.
- Tree edges are *supervision*; separate `spawnedBy` links preserve actor ancestry.
- Runtime snapshot IDs are internal, non-user-forgeable; no UUID required per actor request. Stable opaque handles may be generation-tagged.
- Cycles, duplicate node IDs, stale generations, excessive fanout/depth, partial results and concurrent termination must be rejected or explicitly flagged.
- Sensitive actor state, mailbox payloads, tokens, credentials and exception strings must not be exposed.

## API v1 (read-only)

`GET /api/v1/supervision/tree` — bounded last-completed snapshot.
`POST /api/v1/supervision/snapshots` — request a fresh snapshot (requires privileged auth; rate limited).
`GET /api/v1/supervision/snapshots/{id}` — status or result; pending/partial/complete.
`GET /api/v1/supervision/events` — authenticated SSE stream of sanitized lifecycle deltas.

Example snapshot:

```json
{
  "schemaVersion": 1,
  "snapshotId": "sample-42",
  "status": "partial",
  "startedAt": "2026-10-20T20:00:00Z",
  "finishedAt": "2026-10-20T20:00:01Z",
  "supervisors": [
    {"id":"root","parentId":null,"status":"running","generation":1,"observedAt":"2026-10-20T20:00:00Z"},
    {"id":"S","parentId":"root","status":"running","generation":3,"observedAt":"2026-10-20T20:00:00Z"}
  ],
  "actors": [
    {"id":"A","supervisorId":"S","spawnedBy":null,"kind":"private","status":"running","observedAt":"2026-10-20T20:00:00Z"},
    {"id":"B","supervisorId":"S","spawnedBy":"A","kind":"private","status":"running","observedAt":"2026-10-20T20:00:00Z"}
  ],
  "missingSupervisorIds": [],
  "warnings": []
}
```

## Implementation stages

1. Define supervisor-tree registry and authenticated snapshot CONTROL request/response with bounded aggregation and generation fencing in Java runtime, then LLVM.
2. Add compiler-lowered `define supervisor`, `on_start`, and root bootstrap; test source-level S launches B.
3. Build a native Oreslang HTTP actor exposing sanitized read-only snapshots. It must communicate through an explicit authorized observability capability, not through arbitrary actor heap access.
4. Build a small static browser UI: expandable supervision tree, actor details, health badges, counters, partial-result banners, and SSE deltas. No mutation controls until authorization/audit semantics are proven.
5. Run exact-tree CI on Java/GraalVM and LLVM; distinguish source tests from host-only substrate tests.

See source compiler RFC: oreslang-source.java PR #1758.
