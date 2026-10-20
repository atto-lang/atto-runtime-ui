# Web inspector

Serve `web/` as static files from the future Oreslang HTTP actor, with `/api/v1/supervision/*` routed to an authorized runtime snapshot capability.

This frontend does **not** use mock data, does not execute remote HTML, and displays a clear error when the backend is unavailable. It renders with `textContent`, not `innerHTML`, and rejects malformed trees, cycles, duplicate IDs, excessive depth, and oversized snapshots.

Run the frontend with any local static HTTP server for layout development, but it will show **Unavailable** until a real Oreslang backend implements the API. Authentication, authorization, CSRF protection for POST, SSE reconnect bounds, CSP, and server-side request limits must be completed before exposing it beyond loopback.
