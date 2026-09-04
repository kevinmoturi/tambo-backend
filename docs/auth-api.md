# Auth API

Base path `/api/auth`. All bodies are JSON. All errors use the envelope
described in [architecture.md](architecture.md#error-model) — **branch on
`code`, not on `message`.**

Authenticated endpoints expect:

```
Authorization: Bearer <accessToken>
```

## Token pair

Every successful credential exchange returns:

```json
{
  "user": { "_id": "...", "name": "Ada Lovelace", "email": "ada@tambo.app", "role": "user", "createdAt": "...", "updatedAt": "..." },
  "tokens": { "accessToken": "eyJ...", "refreshToken": "9f3c...", "expiresIn": "15m" }
}
```

`passwordHash` is never serialized.

---

## POST /register

Creates an account and signs the user in.

```json
{ "name": "Ada Lovelace", "email": "ada@tambo.app", "password": "8+ chars, at most 72 bytes" }
```

`201` → token pair.

| Code | Status | Meaning |
|---|---|---|
| `validation_error` | 400 | See `details` for the offending fields |
| `email_taken` | 409 | Case-insensitive; `A@x.com` collides with `a@x.com` |
| `rate_limited` | 429 | 10 per hour per IP |

Unknown keys are stripped, so posting `"role": "admin"` does nothing.

## POST /login

```json
{ "email": "ada@tambo.app", "password": "..." }
```

`200` → token pair.

| Code | Status | Meaning |
|---|---|---|
| `invalid_credentials` | 401 | Wrong password **or** unknown email — deliberately indistinguishable |
| `rate_limited` | 429 | 5 per 15 min per email+IP |

Once the budget is spent, even the *correct* password returns 429.

## POST /refresh

```json
{ "refreshToken": "9f3c..." }
```

`200` → a **new** pair. The presented token is now dead: rotation means storing
the replacement and discarding the old one.

| Code | Status | Meaning |
|---|---|---|
| `invalid_refresh_token` | 401 | Unknown, expired, or the account is gone |
| `refresh_token_reused` | 401 | Replay detected — **every session in that family was just revoked.** Send the user to sign-in |
| `rate_limited` | 429 | 60 per hour per IP |

### Client contract

On any `401` from a normal API call with `code: "token_expired"`, call
`/refresh` once and retry. On `refresh_token_reused` or
`invalid_refresh_token`, clear stored tokens and show the login screen — do not
retry.

## POST /logout

```json
{ "refreshToken": "9f3c..." }
```

`204`. Idempotent — an unknown token also returns `204`, revealing nothing.
Revokes only that session.

## POST /forgot-password

```json
{ "email": "ada@tambo.app" }
```

`204` **always**, whether or not the account exists — otherwise the endpoint
becomes an account-existence oracle. Requesting a new link invalidates any
previous one.

| Code | Status | Meaning |
|---|---|---|
| `rate_limited` | 429 | 3 per hour per email+IP |

In development (`MAIL_DRIVER=console`) the link is printed to the server log.

## POST /reset-password

```json
{ "token": "<from the emailed link>", "password": "new password" }
```

`200` → token pair. Single use, expires after `PASSWORD_RESET_TTL_MINUTES`
(default 60), and **revokes every existing session** for that user.

| Code | Status | Meaning |
|---|---|---|
| `invalid_reset_token` | 401 | Unknown, already used, or expired |
| `rate_limited` | 429 | 10 per hour per IP |

---

## GET /me 🔒

`200` → `{ "user": { ... } }`

## POST /change-password 🔒

```json
{ "currentPassword": "...", "newPassword": "min 8 chars" }
```

`200` → a fresh token pair. **Revokes every other session AND every
outstanding password-reset link**, including the caller's previous session —
so use the returned pair from here on. A reset link issued before the change
can never take the account afterwards.

| Code | Status | Meaning |
|---|---|---|
| `invalid_credentials` | 401 | `currentPassword` is wrong |
| `no_password_credential` | 400 | Account has no password (a future OTP-only account) |

## POST /logout-all 🔒

`204`. Revokes every session for the caller, this device included.

## GET /sessions 🔒

Optionally send `X-Refresh-Token: <your refresh token>` to have your own row
flagged `current`. A header rather than a query parameter, because query
strings end up in access logs.

```json
{
  "sessions": [
    { "id": "665f...", "userAgent": "Tambo/1.0 (iOS 17)", "createdAt": "...", "expiresAt": "...", "current": true }
  ]
}
```

## DELETE /sessions/:id 🔒

`204`. Revokes one session belonging to the caller.

| Code | Status | Meaning |
|---|---|---|
| `session_not_found` | 404 | Unknown, already revoked, **or owned by someone else** — the same answer either way, so ids cannot be probed |

---

## Health

### GET /api/health

`200` when the database is connected, `503` when it is not — point your load
balancer at this.

```json
{ "status": "ok", "database": "connected", "uptime": 42, "timestamp": "..." }
```

## Error code index

| Code | Status |
|---|---|
| `validation_error` | 400 |
| `invalid_json` | 400 |
| `no_password_credential` | 400 |
| `unauthorized`, `missing_token`, `invalid_token`, `token_expired` | 401 |
| `invalid_credentials` | 401 |
| `invalid_refresh_token`, `refresh_token_reused` | 401 |
| `invalid_reset_token` | 401 |
| `forbidden` | 403 |
| `route_not_found`, `user_not_found`, `session_not_found` | 404 |
| `email_taken`, `duplicate_key` | 409 |
| `payload_too_large` | 413 |
| `rate_limited` | 429 |
| `internal_error` | 500 |
