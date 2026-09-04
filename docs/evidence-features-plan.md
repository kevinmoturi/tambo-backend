# Build plan: the first three major features

_Derived from the product docs (feasibility triage, F1/F3 deep-dives, Evidence
Pack & Delivery design). The backend's job in one sentence: receive theft
evidence provably intact, and turn it into a filed, evidenced, insurer-ready
pack delivered by email._

```
F-A  Devices, Episodes & Trusted Contacts   (the spine: who/what/when)
F-B  Evidence Ingest                        (get it off the phone, provably)
F-C  Evidence Pack & Delivery (email-first) (turn it into money and action)
```

Build order F-A -> F-B -> F-C: ingest cannot authenticate without device
tokens; packs cannot assemble without envelopes. Every phase lands with the
established house rules: zod at the edge, services own logic, atomic claims for
anything consumable, tests against real Mongo, docs updated.

---

## F-A - Devices, Theft Episodes & Trusted Contacts

### Entities

**Device** (belongs to a User; a user has many devices)
- Owner-entered IMEI(s) (Android 10+ blocks reading it), make, model, colour,
  purchase info (optional).
- **Device token** issued at enrolment: opaque, hashed at rest (existing token
  discipline), scoped ONLY to evidence ingest. Deliberately not the user JWT:
  the app on a stolen phone must upload evidence even if sessions are revoked,
  and a leaked device token must never grant account access. Revocable per
  device; rotated on re-enrolment.

**TheftEpisode** (the doc's trailId; groups all evidence of one theft)
- Opened by: device threshold signal via ingest, OR owner "mark as stolen"
  from another device (authenticated) - unlock detection must not be the only
  trigger (F1 doc).
- States: open -> resolved(recovered | closed). Episode state drives retention.

**TrustedContact**
- Name + email now; phone stored for the WhatsApp future.
- Consent state machine: pending -> opted_in | declined | revoked. Nomination
  emails the contact accept/decline links (opaque-token pattern). Email alerts
  flow by default with opt-out; WhatsApp (later) flows ONLY to opted_in.

### Endpoints
- Device CRUD, `POST /devices/:id/mark-stolen`, `mark-recovered`
- Device token issue/revoke
- Trusted-contact CRUD + public consent accept/decline endpoints

## F-B - Evidence Ingest

- `POST /api/v1/evidence`: batch of envelopes
  `{id, createdAt, type, episodeId?, payload, sha256}`; envelope id is the
  idempotency key (unique index + duplicate-key translation). Server verifies
  sha256, timestamps receipt, ACKs per envelope (client flips PENDING->ACKED).
- Types: UNLOCK_FAILED | TRAIL_POINT | DEVICE_SNAPSHOT | STATUS | PHOTO.
- Media: separate size-capped, hash-verified upload keyed to an envelope.
  v1 storage: **GridFS** (no new infra; storage-agnostic interface so
  S3-compatible object storage is a drop-in later). Resumable/tus = phase 2;
  v1 single-shot multipart with hash-verified retry (safe via idempotency).
- Threshold trigger: UNLOCK_FAILED stream crossing the device threshold
  auto-opens an episode and fires F-C's first-alert. Time-to-first-alert is
  the emotional metric (Evidence doc S2.3).
- Retention as code: per-envelope computed expiresAt + TTL index. Routine 90
  days; episode open extends its envelopes to 12 months. The TTL index IS the
  retention job a regulator asks to see.
- Transport: per-route body limits (global 100kb stays for auth), ingest rate
  limits keyed on device token, partial batches accepted.

## F-C - Evidence Pack & Delivery (email-first)

- Pack assembly per episode, server-side, Kenya-mapped (Evidence doc S4):
  device identity, incident summary, unlock-attempt log, location trail,
  photos if any, integrity manifest, owner action checklist (operator SIM
  block, OB filing, eCitizen abstract, IMEI blacklist).
- Formats: JSON first (also the PDF's input), then PDF via pdfkit (pure JS,
  no headless browser). v1 trail rendering: coordinates + maps LINK; static
  map image awaits a maps API key (decision #3).
- Integrity manifest: per-item SHA-256 (captured at ingest), server receipt
  timestamps, Ed25519 server signature. Product wording: tamper-evident
  business record - NEVER "forensic certification" (Evidence doc S4.3).
- Delivery via Resend (live, DMARC-aligned): tiny first-alert at episode
  open; full pack email with PDF to owner + trusted contacts. Per-recipient
  delivery state so retries never double-send.
- WhatsApp: deferred - needs WABA + BSP + approved Utility templates +
  opt-in plumbing. Email spine designed so WhatsApp is an added channel.

## Decisions (none block F-A)

| # | Decision | Default if unanswered |
|---|---|---|
| 1 | **Hosting region** - blocks the DPIA cross-border section (Kenya DPA high-risk processing). | Owner/legal decision - flagged, not defaulted |
| 2 | Media storage v1 | GridFS now, S3-compatible later |
| 3 | Static map in PDF | Link-only v1 |
| 4 | Device token lifetime | Long-lived + revocable, rotated on re-enrolment |
| 5 | Routes namespace | /api/v1/devices, /api/v1/evidence, /api/v1/episodes |

## Notes against the product docs

- The docs assume "backend not yet built" - it now exists: email-OTP auth,
  sessions, Resend delivery (verified domain, DMARC-aligned), rate limiting,
  error envelope, test infrastructure. F-A/B/C build on that spine.
- The F1/F3 hardware spike (Transsion/Samsung) decides how RICH evidence is
  (7-point trail vs attempt-only points) but changes nothing server-side -
  envelope-based ingest accepts whatever lands. Backend work parallelizes
  with the device spike.
- Email deliverability prerequisite from the Evidence doc (SPF/DKIM/DMARC on
  a real from-domain) is already satisfied.
