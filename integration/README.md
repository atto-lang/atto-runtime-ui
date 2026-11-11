# Live Java runtime inspector

Use the companion compiler commit recorded in the task receipt (the new runtime methods are required). Build from exact source, not a historical target/classes directory:

```sh
export JAVA_HOME=/Library/Java/JavaVirtualMachines/graalvm-25.jdk/Contents/Home
export COMPILER_DIR=/absolute/path/to/pinned/compiler
(cd "$COMPILER_DIR" && mvn -q -DskipTests package)
bash integration/build.sh
node integration/run-inspector.mjs
```

Open the printed loopback URL. The demo actor is held at a stdout I/O barrier while the guest queues three actual messages. The browser shows `starting`, queue `3`, and unknown supervision. Type `release` into the terminal: guest behavior processes the messages, creates a nested guest actor and terminates, including the child. Refresh to see termination and ancestry. Type `exit` to close. Grants expire after 60 seconds; restart the embedding for another session. `node integration/live-proof.mjs` automates two full runs and negative tests; set `EVIDENCE_DIR` for raw receipts, or `PREVIEW=1` for a 25-second browser inspection window.

The UI's refresh is a read-only GET. It never creates snapshots, grants, actor references, or mutations. The adapter endpoint requires a bootstrap-only random key, and the gateway keeps both native key and broker grants server-side. The UI gateway binds 127.0.0.1 and rejects foreign Host, Origin, Fetch Metadata, all non-GET methods and unrecognized paths. This is a local embedding tool, not a remote multi-user login service. An authorized local browser can read this bootstrap-selected runtime scope.

## Observation semantics

- Actual actor registry, lifecycle, `queuedUserMessages` under mailbox accounting lock, and active receive metadata under lifecycle lock. No behavior, actor state, payload, error string or code image is serialized. The Java record serializer only receives allowlisted metadata records, never actor objects.
- Actual ActorGroup supervisor ownership and distinct `spawnedBy`. Ungrouped actors are grouped under the runtime root for display and explicitly labeled `unmanaged-supervision-unknown`; that grouping is not a claim of supervisory admission.
- Each local actor record is atomic. The collection is a time-stamped, weakly consistent observation, not a globally atomic snapshot. Bounded node truncation is partial; missing counters display unknown; data older than five seconds is stale. A failed/revoked native read clears the UI instead of presenting cached data as fresh.
- Up to 512 terminated metadata records are retained. This is a bounded recent observation window, not a durable lifecycle event log. Each opaque actor UUID is one incarnation; actor `generation=1` describes that identity, not hot-loaded code. The runtime observation epoch fences grants when the host advances observation generation. Existing code-upgrade generation machinery is not certified by this package.
- Grant identity is runtime-local, supervisor-subtree-scoped, expiring, revocable, and unavailable to guest turns. Foreign runtimes and grants are denied. A parent ID outside scope is redacted and marks the observation partial. Native authority is independently checked, then UI PR #5 broker checks and sanitizes again.

## Evidence boundary

This is executed Java guest + runtime + local socket + browser evidence. The compiler can use Truffle's interpreter fallback when its bundled polyglot version differs from the installed GraalVM compiler; the raw logs retain that warning. No native AOT, distributed reserved CONTROL fanout, LLVM/.NET/Wasm/Forge parity, remote authentication, or hosted CI claim is made. Origin required merge checks remain unchanged.
