# Web inspector

Serve `web/` as static files from the future Oreslang HTTP actor, with `/api/v1/supervision/*` routed to an authorized runtime snapshot capability.

This frontend does **not** use mock data, does not execute remote HTML, and displays a clear error when the backend is unavailable. It renders with `textContent`, not `innerHTML`, and rejects malformed trees, cycles, duplicate IDs, excessive depth, and oversized snapshots.

Run the frontend with any local static HTTP server for layout development, but it will show **Unavailable** until a real Oreslang backend implements the API. Authentication, authorization, CSRF protection for POST, SSE reconnect bounds, CSP, and server-side request limits must be completed before exposing it beyond loopback.

## Local source-free snapshot-details checks

Run `npm test` (Node 22+) for a fail-closed allowlist of public actor/supervisor metadata. The selected-node details pane intentionally **does not** render arbitrary JSON fields from the runtime; only explicitly approved scalar fields survive, and strings are capped. The tests inject payloads named `state`, `credentials`, and `mailboxPayload` to prove they are not reflected. The server must still independently authenticate and sanitize every response. These are UI safety checks only, not native Oreslang execution or CONTROL admission proof.
