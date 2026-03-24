# Security Rollout Note

## What Changed

- Player-scoped HTTP endpoints now require valid player identity.
- JWT validation now rejects unsigned tokens and only accepts signed `HS256` tokens.
- Password storage uses `scrypt`; legacy MD5 hashes are upgraded on successful login.
- Player search no longer accepts SQL injection payloads.
- WebSocket connections now enforce an origin allowlist.

## Runtime Configuration

- `JWT_SECRET` is required.
- `ADMIN_API_KEY` is optional; if set, `GET /api/admin/server-stats` accepts `x-admin-key` with that value.
- `WS_ALLOWED_ORIGINS` is optional and comma-separated.
  - Example: `WS_ALLOWED_ORIGINS=https://game.example.com,https://staging.example.com`
  - If unset, the server allows WebSocket browser origins that match the request host.
  - Non-browser WebSocket clients without an `Origin` header are still allowed.

## Client Compatibility

### HTTP authentication

Protected endpoints now accept any of the following:

- `Authorization: Bearer <token>`
- `twnr_auth` cookie set by `/api/auth/register` or `/api/auth/login`
- `twnr_session` cookie set during the WebSocket handshake

### Protected endpoints

- `GET /api/ship/:playerId`
- `GET /api/cargo/:playerId`
- `POST /api/move`
- `POST /api/trade`
- `POST /api/port/buy-fighters`
- `POST /api/port/buy-shields`
- `POST /api/port/buy-holds`
- `POST /api/ship/exchange`

### Compatibility bridge

- Browser clients that already open a WebSocket and then call protected HTTP endpoints on the same origin may continue to work via the `twnr_session` cookie.
- Browser clients that use login/register can also rely on the `twnr_auth` cookie.
- The `welcome` WebSocket message still includes `token`, so clients can migrate to bearer auth explicitly.

## Recommended Client Migration

1. Read and store the JWT returned by `/api/auth/login`, `/api/auth/register`, or the WebSocket `welcome` payload.
2. Send `Authorization: Bearer <token>` on all protected HTTP requests.
3. Keep sending `playerId` during transition if needed; the server still accepts it, but it must match the authenticated player.
4. Later, simplify player-scoped POST bodies by omitting `playerId` entirely.

## Operational Rollout

1. Set a strong `JWT_SECRET` in every environment.
2. Set `WS_ALLOWED_ORIGINS` explicitly in staging and production.
3. If existing admin tooling depends on header auth, set `ADMIN_API_KEY` to the intended shared secret.
4. Monitor 401/403 rates on protected endpoints and rejected WebSocket upgrades after deployment.

## Deferred Items

- WebSocket connections still auto-provision anonymous players once allowed through origin checks.
- Public information disclosure endpoints remain unchanged pending product decisions.
