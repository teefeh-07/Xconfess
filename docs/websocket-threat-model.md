# WebSocket Threat Model — xConfess

## Scope

Covers the `/notifications` and `/reactions` Socket.IO namespaces served by the NestJS backend.

---

## Assets

| Asset | Classification |
|---|---|
| JWT access token | Secret — must never appear in logs |
| Session cookie | Secret — must never appear in logs |
| User email | PII — excluded from telemetry |
| Wallet address | PII — excluded from telemetry |
| `userId` (UUID) | Internal identifier — safe to log |
| Correlation ID | Ephemeral trace key — safe to log |

---

## Threat: Auth credential leakage via logs

**Vector:** A failed WebSocket handshake triggers a log entry containing the raw `Authorization` header or `Cookie`.

**Mitigation (implemented):**

- `scrubPii()` in `ws-auth-telemetry.ts` strips any key matching `/^(authorization|cookie|token|jwt|email|wallet|password|secret)/i` before it reaches the logger.
- Gateways never pass the raw token string to `emitWsAuthFailure`.
- The `auth_error` event sent to the client contains only a `reason` enum code and a `correlationId` — never the raw error message.

---

## Auth failure reason codes

| Code | Meaning |
|---|---|
| `TOKEN_MISSING` | No `Authorization` header or `token` query param present |
| `TOKEN_MALFORMED` | Header present but JWT structure is invalid |
| `TOKEN_EXPIRED` | JWT signature is valid but `exp` claim has passed |
| `TOKEN_INVALID_SIGNATURE` | JWT signature verification failed |
| `USER_NOT_FOUND` | Token valid but referenced user does not exist |
| `SESSION_REVOKED` | Token is on the revocation list |
| `UNKNOWN` | Catch-all for unclassified errors |

---

## Correlation ID

Every auth failure emits a UUID v4 **correlation ID** that:

1. Is logged server-side alongside the reason code and gateway name.
2. Is sent to the client in the `auth_error` event payload.
3. Can be used to correlate client-reported errors with server logs **without** any PII.

---

## Logging contract

\`\`\`
WS_AUTH_FAILURE gateway=<GatewayName> reason=<CODE> correlationId=<uuid>
\`\`\`

Fields **never** present in this log line:
- Raw Authorization header value
- Cookie header value
- JWT string
- Email address
- Wallet address

---

## Out of scope

- WebSocket transport protocol changes (keep Socket.IO for now)
- Rate limiting / brute-force protection (separate issue)
- Refreshing tokens over WebSocket

---

## Test coverage

`src/notifications/gateways/__tests__/gateways.spec.ts` covers:

- Missing token → `TOKEN_MISSING` + disconnect
- Expired token → `TOKEN_EXPIRED` + disconnect
- Malformed token → `TOKEN_MALFORMED` + disconnect
- Invalid signature → `TOKEN_INVALID_SIGNATURE` + disconnect
- Valid token → no `auth_error`, no disconnect
- `scrubPii` removes all sensitive keys
- `emitWsAuthFailure` returns a valid UUID and logs without PII
