# Cloudflare runbook

What to configure in Cloudflare for Tambo, in order. The code side is already
done — this file is the operator's checklist. Prerequisite for everything here:
**a domain you control, added as a zone in a Cloudflare account.**

## 1. Resend sending domain (unblocks real email — do this first)

Until this is done, Resend is in onboarding mode: it can only send from
`onboarding@resend.dev` and only TO the Resend account owner's address, so no
real user receives OTP codes or reset links.

1. In **Resend → Domains → Add Domain**, enter the sending domain
   (e.g. `mail.tambo.app` or the apex). Resend shows the exact DNS records.
2. In **Cloudflare → the zone → DNS → Records**, add what Resend listed —
   typically:
   - **TXT** SPF record (e.g. `send.<domain>` → `v=spf1 include:amazonses.com ~all`)
   - **MX** record for the same subdomain (Resend's bounce handling)
   - **TXT** DKIM record (`resend._domainkey.<domain>` → the long key value)
   Copy them **exactly** from the Resend dashboard — values differ per account.
3. **DNS only (grey cloud) for all of these.** Mail-related DNS must never be
   proxied; the orange cloud breaks SPF/MX resolution.
4. Back in Resend, click **Verify**. Propagation is usually minutes on
   Cloudflare, occasionally longer.
5. Once verified, update production `.env`:
   ```
   MAIL_DRIVER=resend
   MAIL_FROM=Tambo <no-reply@mail.tambo.app>   # an address on the verified domain
   RESEND_API_KEY=<the key>
   ```
   The app refuses to boot as `resend` without a key, and refuses unknown
   driver names outright — misconfiguration fails loudly, not silently.

## 2. Proxying the API through Cloudflare

When the backend gets a public hostname (e.g. `api.tambo.app`):

1. **DNS**: an `A`/`CNAME` record for `api` pointing at the origin host,
   **proxied (orange cloud)** — this is what puts Cloudflare's WAF/DDoS layer
   in front of the API.
2. **SSL/TLS → Overview → Full (strict)**. Never "Flexible" — that terminates
   TLS at Cloudflare and talks plain HTTP to the origin, silently.
3. **SSL/TLS → Edge Certificates**: enable **Always Use HTTPS**.
4. Turn **OFF** speed features that mangle APIs for this hostname (Rocket
   Loader, Auto Minify, Email Obfuscation) — Configuration Rules → new rule for
   `api.tambo.app/*` if the zone also serves a website.
5. **Caching**: add a Cache Rule for `api.tambo.app/*` → **Bypass cache**. An
   API response cached at the edge is a data leak waiting to happen.

## 3. TRUST_PROXY — the setting that actually interacts with the code

`req.ip` feeds the per-IP rate limiter, so Express must peel exactly the right
number of proxy hops off `X-Forwarded-For`:

| Topology | TRUST_PROXY |
|---|---|
| Cloudflare → origin directly | `1` |
| Cloudflare → load balancer → origin | `2` |
| No Cloudflare, one LB | `1` |

Cloudflare appends the real client IP to `X-Forwarded-For`, so with the correct
hop count Express resolves it without any `CF-Connecting-IP` handling. The app
refuses to boot on a non-integer value, but **a wrong count fails silently**:
too low and every user shares Cloudflare's IP (one attacker rate-limits the
whole user base), too high and clients can forge their IP with a header. Verify
after deploy: hit `/api/health` from two networks and check the structured
warn-log lines show different `ip` values on bad requests.

Recommended hardening once stable: restrict origin ingress to
[Cloudflare's published IP ranges](https://www.cloudflare.com/ips/) so nobody
can bypass the proxy and talk to the origin directly (which would also let them
spoof `X-Forwarded-For`).

## 4. WAF quick wins (optional but cheap)

- **Security → WAF → Managed rules**: enable the free Cloudflare Managed
  Ruleset for the zone.
- **Rate limiting rules** (edge-level, complements the app's own):
  a coarse rule like `> 100 requests / 10s per IP to api.tambo.app/*` catches
  floods before they reach the origin at all. Keep it far looser than the
  app-level budgets — the app's limits are the precise ones.
- **Bots → Bot Fight Mode**: fine for an API used by a mobile app; revisit if
  it ever false-positives your own clients.

## What I need from the owner to execute this

1. The domain name (and whether email should send from the apex or a
   subdomain like `mail.`).
2. Either: paste the DNS records from Resend into Cloudflare yourself
   (10 minutes, steps above), or provide a Cloudflare API token scoped to
   **Zone → DNS → Edit** for that one zone.
3. The production hostname for the API when hosting is chosen, to finish
   section 2 and set `TRUST_PROXY`.
