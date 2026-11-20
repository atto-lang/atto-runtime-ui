# Web inspector — bounded frontend contract

Serve `web/` as static files from a future authenticated Oreslang HTTP actor. **The server, privileged supervisor snapshot path and SSE observation broker do not yet exist here.** Without a real backend the browser shows **Unavailable**, not mock runtime data.

The UI uses `textContent` rather than `innerHTML`, an allowlist for node details, a fail-closed v1 snapshot validator, 10,000-node/64-level limits, a 1 MiB browser streaming response cap, and generation/timestamp requirements. Unknown statuses, missing roots, cyclic/orphan links and contradictory `complete` results are rejected. A bad response removes stale content rather than presenting old data as current. User-triggered snapshots are tied to the returned `snapshotId` and never substituted with the last-completed tree.

The static `index.html` intentionally contains no CSRF token. To enable POST, the **authorized server** must inject a session-bound `<meta name="csrf-token" content="...">` into the served HTML, without caching or logging it; the browser transmits it as `X-CSRF-Token`. The server must check Origin/Referer, session cookie/authorization, per-tenant privilege, rate limits and CSRF independently. Without a server-provisioned token, snapshot creation fails closed. All API responses must be `application/json` and `Cache-Control: no-store`.

To run source-local checks on Node 22+, use `npm test`. These validate only the JS presentation boundary, not real native Oreslang guest execution or CONTROL/capability correctness. See [ObservableActor broker integration](../docs/OBSERVABLE_ACTOR_UI_INTEGRATION.md) for the staged observation design. No browser direct subscription to actor instances is permitted.

Production requirements still include CSP/security headers, same-origin restrictions, per-request caps, authentication and authorization, reconnect/CSRF enforcement, audit logging without sensitive values, and exact-source native runtime proof. Do not expose beyond loopback before those gates pass.
