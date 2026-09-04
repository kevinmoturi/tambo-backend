# Build plan & status

The single source of truth for where the backend is and what comes next.
Last updated: 2026-09-04.

Legend: ✅ done & tested · 🔶 partially done · ⬜ not started · 👤 needs a human action

---

## Done

### ✅ Phase 0 — Scaffold cleanup
Toolchain baseline: strict TypeScript for `src/` **and** `tests/`, ESLint +
Prettier, Jest against a real in-memory MongoDB (one shared server, random
database per test file), scripts for build/typecheck/lint/format/test.

### ✅ Phase 1 — Auth core
JWT access tokens (15 min, stateless) + opaque rotating refresh tokens
(30 days, SHA-256 hashed at rest, per-login families, reuse detection burns the
family). Endpoints: register, login, refresh, logout, logout-all, me.
User model already carries `phone` / `phoneVerifiedAt` (sparse-unique) so
phone OTP needs **no migration**.

### ✅ Phase A — Validation
zod schemas as the single source of request shapes; `validate()` middleware
strips unknown keys (mass-assignment proof) and reports every bad field at once.

### ✅ Phase B — Service layer
Credential-agnostic `session.service` + `credentials/password.credential`;
controllers never touch models; pluggable mailer (console/noop drivers).

### ✅ Phase C — Password lifecycle
change-password, forgot-password (always 204), reset-password. Reset tokens:
opaque, hashed, single-use via atomic claim, 60-min TTL. Any password set goes
through one `setPassword` mechanism that revokes all sessions **and** all
outstanding reset links.

### ✅ Phase D — Abuse protection
Mongo-backed rate limiting (correct across instances): login 5/15min per
email+IP, register 10/hr, forgot-password 3/hr, reset 10/hr, refresh 60/hr.
Windows anchor on first hit; stale windows reset immediately.

### ✅ Phase E — Hardening
helmet, deny-all CORS default, 100kb body cap, validated TRUST_PROXY,
`/api/health` (503 when DB down), session list + per-device revocation,
structured 4xx logging, hello-world scaffold removed.

### ✅ Deep audit + fixes (2026-09-04)
8-angle review, top findings verified live, **all 17 applied** — including the
two real security bugs (stale reset-link account takeover; refresh rotation
race) and the fail-silent config traps (JWT secret fallback, TRUST_PROXY,
MAIL_DRIVER — all now refuse to boot instead). Prod dependencies audit clean
(`qs` overridden to a patched version).

**Current state: 83 tests green, lint/typecheck/build clean, verified
end-to-end against the Atlas cluster. Committed and pushed 2026-09-04.**

---

## Open items

### 👤 Immediate human actions
1. ✅ **Commit the work** — committed as a series and pushed (2026-09-04).
2. ✅ **Rotate the Atlas password** — rotated (2026-09-04); `.env` updated and
   the connection verified.
3. ⬜ **Provider setup: email AND SMS, decided together** (email:
   Resend/SES/Postmark + sending domain + SPF/DKIM; SMS: e.g. Africa's
   Talking/Twilio) — owner will provide later. The long pole before launch;
   the email-gated batch AND phone OTP both wait on it.

### ⬜ Phone OTP login — designed-for, ON HOLD until providers are settled

**Owner's call (2026-09-04): do not start until the SMS/notification provider
is chosen, settled alongside the email provider.** Both feed the same
`Notifier` seam, so picking them together avoids building the abstraction
twice. Everything below is ready to go the moment that lands.
Already in place: `phone`/`phoneVerifiedAt` fields (no migration),
`passwordHash` optional (OTP-only accounts are valid), credential-agnostic
sessions (token issuance/rotation/revocation reused unchanged), rate-limit
machinery, `no_password_credential` error path.

To build:
1. `models/otpChallenge.model.ts` — hashed code, TTL, attempt counter (same
   opaque-token discipline; helpers already generalized).
2. `services/credentials/otp.credential.ts` mirroring the password credential.
3. `POST /auth/otp/request` + `POST /auth/otp/verify`.
4. Generalize `Mailer` → `Notifier` with an SMS driver.
5. E.164 normalization (`libphonenumber-js`) before storage.
6. Rate limits: per phone, per IP, resend cooldown.

**✅ Decision made (2026-09-04): ONE account.** A human with both a phone and
an email is a single `User` document carrying both identifiers. Consequences
for the OTP build:

- `User` keeps one row per person; `email` and `phone` are independent
  sparse-unique fields on it — no separate identity table.
- Logging in via either identifier resolves to the same account and the same
  sessions/roles.
- **Linking requires proof of ownership**: adding a phone to an email account
  (or vice versa) must verify the new identifier (OTP to the phone, link to the
  email) while authenticated — never silently merge two records that share
  nothing but a claimed identifier.
- Registering a phone that already belongs to an account is a conflict
  (`phone_taken`), mirroring `email_taken` — not an auto-merge.

### 🔶 Observability — scheduled after the email service is up
Minimal structured 4xx logging exists (audit fix). The rest of this batch is
deliberately sequenced behind the email provider (owner's call, 2026-09-04):
real logger with request ids, auth-event audit trail, email verification, the
real mail driver, account lockout, 2FA, OpenAPI spec, CI pipeline.

### ⬜ Batch gated on the email service (in priority order once it lands)
1. **Real mail driver** — one file in `src/services/mailer/` + `MAIL_DRIVER`
   env once the provider account exists.
2. **Email verification** — `emailVerifiedAt` exists, nothing sets it. Also
   the mitigation for register-with-someone-else's-email (accepted gap).
3. **Observability** — real logger with request ids, auth-event audit trail.
4. **Account lockout** on top of rate limiting.
5. **2FA (TOTP).**
6. **OpenAPI spec** generated from the zod schemas → typed mobile client.
7. **CI pipeline** (typecheck + lint + test; `MONGOMS_VERSION` pin is
   macOS-12-only, Linux runners use the default).

### 👤 At deploy time
- Set `TRUST_PROXY` to the real proxy hop count (boot fails on non-integers).
- Set `CORS_ALLOWED_ORIGINS` only if a browser client exists (empty = deny all,
  correct for mobile-only).
- `NODE_ENV=production` + real `JWT_ACCESS_SECRET` (boot fails without it).

## Not planned
- Cookie/session auth for browsers — the API is token-based and mobile-first.
- Social login — no requirement yet.
