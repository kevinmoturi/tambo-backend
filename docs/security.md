# Security notes

What is defended, how, and what is knowingly left open.

## Passwords

- **bcrypt**, work factor 12 (`BCRYPT_ROUNDS`). Tests drop to 4 for speed.
- Hashes use `select: false`, so they are excluded from queries unless a caller
  explicitly opts in, and are stripped again in `toJSON`.
- Passwords are capped at **72 bytes** (not characters - multibyte UTF-8
  counts). bcrypt silently ignores bytes past 72, so any larger cap would let
  two different long passwords open the same account.

## Account enumeration

Three endpoints could otherwise reveal who has an account:

| Endpoint | Defence |
|---|---|
| `/login` | Identical `invalid_credentials` for unknown email and wrong password, **and** a bcrypt comparison against a dummy hash when the user is missing, so timing does not leak either |
| `/forgot-password` | Always `204`, mail sent only if the account exists |
| `/register` | Genuinely does leak, by necessity — `email_taken` is unavoidable. Rate limiting is the mitigation |

## Token storage

Refresh tokens and password-reset tokens are random opaque values; only their
SHA-256 hashes are persisted. A database dump therefore yields no usable
sessions and no password-reset capability.

Access tokens are not stored at all — that is the point of them being stateless.

## Session revocation

Every path that should evict an attacker does:

| Event | Effect |
|---|---|
| Refresh token replayed | Whole family revoked |
| Password changed | All sessions revoked, all outstanding reset links invalidated, fresh pair returned |
| Password reset | All sessions revoked, all other reset links invalidated, fresh pair returned |
| `/logout-all` | All sessions revoked |
| `DELETE /sessions/:id` | That session revoked |

Refresh rotation and reset-token consumption both use an **atomic claim**
(`findOneAndUpdate` flipping the revoked/used marker only while unset), so a
concurrent replay cannot slip through the read-check-write gap - exactly one
presenter wins and every simultaneous loser is treated as a replay.

The residual window is the access token's remaining lifetime, at most 15
minutes by default.

## Rate limiting

Counters live in MongoDB rather than memory, so limits hold across multiple
instances — an in-memory counter would let *N* instances permit *N* times the
intended budget.

Keys are `sha256(ip | subject)` truncated, so the counter collection is not a
harvestable list of email addresses.

The window is anchored on first hit (`$setOnInsert`), so a burst cannot keep
pushing the expiry forward and starve the reset.

**`TRUST_PROXY` must match your real topology.** Setting it higher than the true
number of proxies lets any client forge `X-Forwarded-For` and sidestep every
IP-keyed limit.

## Transport and headers

`helmet` for standard security headers, `x-powered-by` disabled, JSON bodies
capped at 100kb, and CORS denied by default — a native mobile client sends no
`Origin` and needs no CORS grant. Add browser origins to
`CORS_ALLOWED_ORIGINS` only when a web client actually exists.

## Mass assignment

Every request body is parsed by a zod schema that **strips unknown keys** before
anything reaches a model. Posting `role: "admin"` to `/register` is inert, and
there is a test asserting exactly that.

## Known gaps

Deliberate, and worth revisiting before public launch:

1. **No email verification.** Anyone can register with an address they do not
   control. Password reset still works, because email is treated as an
   identifier rather than a proven channel. Adding verification later is
   additive — the `emailVerifiedAt` field already exists.
2. **No account lockout**, only rate limiting. A patient distributed attacker
   with many IPs is slowed, not stopped.
3. **No 2FA.**
4. **Access tokens cannot be revoked mid-life** (see architecture.md).
5. **Minimal auth logging only.** Every expected 4xx (failed login, replay,
   429) emits one structured `console.warn` line, so attacks are at least
   visible - but there is no real logger, request ids, or retention story yet.
6. **Secrets come from the environment**; there is no integration with a managed
   secret store, and no key rotation scheme for `JWT_ACCESS_SECRET` — rotating
   it invalidates every access token immediately (refresh tokens survive,
   because they are database-backed rather than signed).
