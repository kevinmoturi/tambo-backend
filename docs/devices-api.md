# Devices, Episodes & Trusted Contacts API (F-A)

Base path `/api/v1`. Same envelope and conventions as [auth-api.md](auth-api.md):
errors are `{ code, message }`, branch on `code`. All endpoints require
`Authorization: Bearer <accessToken>` except the public consent links.

## Devices

### POST /devices 🔒
Enrols a phone. IMEIs are owner-entered (Android 10+ blocks reading them).

```json
{ "name": "My Tecno", "imeis": ["356938035643809"], "make": "Tecno",
  "deviceModel": "Spark 20", "colour": "black", "purchaseInfo": "..." }
```

`201` → `{ device, ingestToken }`. **`ingestToken` appears in this response and
never again** — store it on the phone; only its hash is kept server-side. It is
the device's evidence-upload credential (header `X-Device-Token`, F-B): valid
even after the owner's sessions are revoked, and useless for anything but
ingest if it leaks.

### GET /devices 🔒 · GET /devices/:id 🔒 · PATCH /devices/:id 🔒 · DELETE /devices/:id 🔒
Standard management. Reads/writes are owner-scoped; someone else's device id
404s exactly like a missing one. `DELETE` returns `409 episode_open` while a
theft episode is open — resolve first.

### POST /devices/:id/token 🔒 → `{ ingestToken }` (rotates; old token dies instantly)
### DELETE /devices/:id/token 🔒 → 204 (revokes; device cannot upload until re-enrolled)

## Theft episodes

One episode = one theft incident; all evidence and the eventual report group
under it. The database enforces at most ONE open episode per device.

### POST /devices/:id/mark-stolen 🔒
Body: `{ "note": "snatched at Kencom stage ~18:30" }` (optional).
`201` when this call opened the episode, `200` when converging on one already
open (the device's own threshold signal may have fired first — F-B). Flips the
device to `stolen`.

### POST /devices/:id/mark-recovered 🔒
`200` → resolved episode (`resolution: "recovered"`); device back to `active`.
`404 episode_not_found` when nothing is open.

### GET /episodes?deviceId= 🔒 · GET /episodes/:id 🔒

## The evidence pack (F-C)

The dossier the product exists to produce (Evidence doc S4): incident summary,
device identity (owner-entered IMEIs), failed-unlock log, location trail with
maps links, photos, the Kenya action checklist (OB, eCitizen abstract, IMEI
blacklist, insurer), and a signed integrity manifest.

### GET /episodes/:id/pack 🔒
`200` → `{ pack }` - the machine-readable JSON pack. `pack.integrity` carries
per-item SHA-256 hashes (verified at ingest), server receipt timestamps, the
Ed25519 public key, and a signature over the canonical manifest JSON. Wording
discipline: this is a TAMPER-EVIDENT BUSINESS RECORD, never claimed as
forensic certification.

### GET /episodes/:id/pack.pdf 🔒
`200` → the human-readable PDF (photos embedded when decodable), the document
an owner forwards to an insurer or shows at a police station.

### POST /episodes/:id/send-pack 🔒
Builds the pack and emails the PDF to the owner and every eligible trusted
contact (pending + opted_in; declined/revoked are never contacted). Returns
`{ recipients }`. Re-sending is allowed - more evidence may have landed - and
every send is recorded. Rate-limited (10/hour).

### First alerts (automatic)
The moment an episode opens - owner mark-stolen OR the device threshold - a
tiny first-alert email goes to the owner and eligible contacts (Evidence doc
S2.3: time-to-first-alert is the metric that matters emotionally). Exactly
once per recipient per episode, enforced by a database claim, so converging
openers can never double-alert. The full pack follows via send-pack.

## Trusted contacts

A trusted contact is a third party — consent is THEIRS to give, not the
owner's to tick (Evidence doc §5.2). States:
`pending → opted_in | declined | revoked`.

### POST /trusted-contacts 🔒
```json
{ "name": "Grace Hopper", "email": "grace@example.com", "phone": "+2547..." }
```
`201` → contact (`pending`) and a nomination email to the CONTACT with
equal-weight accept/decline links (single-use, 14-day expiry). Max 3 contacts
per user; self-nomination and duplicates rejected. Rate-limited — Tambo must
not be usable to pester a stranger's mailbox.

### GET /trusted-contacts 🔒 · DELETE /trusted-contacts/:id 🔒
### POST /trusted-contacts/:id/resend 🔒
Re-sends with a FRESH link (old one dies). Per-contact cooldown (default 5
min, `retryAfter` on 429); refused once the contact has answered.

### GET /consent/:token/accept · GET /consent/:token/decline — PUBLIC
Clicked from the contact's mailbox; responds with a small human-readable page.
The token is consumed atomically: one answer, exactly once.

## Error code index (additions)

| Code | Status |
|---|---|
| `contact_limit_reached`, `contact_is_self`, `contact_already_responded` | 400 |
| `missing_device_token`, `invalid_device_token`, `invalid_consent_token` | 401 |
| `device_not_found`, `episode_not_found`, `contact_not_found` | 404 |
| `episode_open`, `contact_exists` | 409 |
