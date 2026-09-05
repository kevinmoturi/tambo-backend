# Access tiers: how deep can Tambo go, and how it gets there

_Advisory / architecture. No code. Companion to the feasibility triage and the
F1/F3/Evidence deep-dives. Written to settle the recurring question —
"these features must go as deep as possible into the phone" — with the real
constraints rather than aspiration._

_This is engineering advisory, not legal advice. The legal lines below must be
confirmed by the project's advocate and the DPIA before launch; the ODPC
registration is already flagged as a prerequisite in the compliance docs._

---

## 0. The one idea to take away

Depth is gated by **three independent things, and all three must open**:

| Gate | Question | Opened by |
|---|---|---|
| **Legal** | Are we allowed to process this data? | Owner consent (+ a lawful basis for third-party/intruder data) |
| **Capability** | Can an app on this device technically do it? | The device-access TIER (below) — *not* consent |
| **Distribution** | Will the store ship it? | Google Play policy, independent of consent |

The trap this document exists to prevent: assuming that **clear owner consent**
opens the capability gate. It does not. There is no Android permission a user
can grant that gives a normally-installed app kernel or system access — the
dialog does not exist. Consent opens the legal gate only. Capability is opened
by *which tier the app is installed into*, and that is a product decision made
before a single line of client code.

---

## 1. The tiers, and what each unlocks

Same feature, four different answers depending on the tier. (Condensed from the
feasibility triage's master table.)

| Capability | Consumer Play (today) | Rooted device | **Device Owner (DPC)** | OEM / system |
|---|---|---|---|---|
| Detect failed **PIN/pattern** unlock | Yes — device-admin callback | Yes | **Yes, cleanly** | Yes |
| Detect failed **biometric** unlock | No | Yes | No | Yes |
| Read kernel / logcat / other apps | **No** | Yes | Limited | Yes |
| Silent **background camera** | **No** | Yes | With the right role | Yes |
| **Background location** trail | Yes (+ Play declaration) | Yes | Yes | Yes |
| Resist uninstall | Weak (admin friction) | Yes | **Yes** | Yes |
| Survive factory reset | No | Yes | Partly (FRP) | Yes |
| Read hardware IMEI | No (owner-enters it) | Yes | Yes | Yes |
| **Install effort for the user** | Tap install | Root the phone | **Factory reset + provision** | Bought pre-installed |

Read the first column as "no special powers." That is the world a Play download
lives in — the same footing as every other app in the store.

---

## 2. Why owner consent does NOT grant depth

The Android security model — per-app sandbox, SELinux, verified boot — withholds
kernel and cross-app reach from app-tier code by construction. Consequences that
surprise people:

- There is **no runtime permission** for kernel access, system logs, or another
  app's memory. Nothing to request, nothing for the user to approve.
- A perfectly clear, freely granted consent screen therefore changes **nothing**
  about capability. The request has nowhere to land.
- The deepest signal a consumer app can legitimately get is the **device-admin
  `onPasswordFailed` callback** (failed PIN/pattern, wakes a dead app). That is
  already the F1 plan, and it is the ceiling on this tier — not a starting point
  to dig below.

Consent is real and necessary. It is simply not the lever for depth.

---

## 3. The legitimate, consented path to depth: Device Owner (DPC)

There IS a lawful, Google-blessed, consent-based way to get most of the red
cells to green — the **Device Owner** role via the Android Management API /
a Device Policy Controller.

Two things to be precise about:

1. **"Device Owner" is an Android technical role, not the everyday phrase.**
   It is not "the person who owns the phone tapped Allow." It is a management
   role granted to the app during **device provisioning** — a factory reset,
   then enrollment by QR code, zero-touch, or an EMM. It is consented (the
   person provisioning chooses it) and lawful.
2. **It is a different product and a different install flow.** You cannot reach
   it from a Play consumer download. The user (or an organization) must enroll
   the device.

What it unlocks: reliable failed-unlock detection, genuine uninstall
resistance, stronger background survival, IMEI access — the "deep" behavior the
brief keeps reaching for. What it costs: the enrollment friction above, a
**much smaller addressable market** (nobody factory-resets a phone to try an
app), and an enterprise-shaped go-to-market.

Who it actually fits: **phones handed out with Tambo already enrolled** — an
NGO issuing devices, a journalist-safety program, a fleet, a police-recovery
pilot. Not a mass-market consumer download.

The other two depth tiers are dead ends for this product: **root** voids
warranty, fails Play Integrity (breaks M-PESA/banking on that phone), can't be
asked of a mass-market user, and Play won't distribute an app requiring it;
**OEM preinstall** is a manufacturer deal, not something you ship.

---

## 4. The third-party (intruder) data point

Owner consent covers the owner's own data. It does **not** cover the person who
picks up / steals the phone and gets photographed or located — a third party
who never consented. That processing needs its own lawful basis
(crime-prevention / legitimate-interest arguments exist and are plausible, but
this is exactly the high-risk processing the DPIA must justify). It is tier-
independent: it applies to consumer-Play and Device-Owner editions alike, and
it is why the Terms already restrict publishing intruder photos. Settle it in
the DPIA, not in the consent copy.

---

## 5. The two products, side by side

| | **Consumer Tambo** (current build) | **Device-Owner Tambo** (a decision, not built) |
|---|---|---|
| Install | Play download, seconds | Factory reset + provision |
| Depth | Device-admin failed-unlock callback is the ceiling | Deep: reliable detection, uninstall resistance, more |
| Market | Mass-market East Africa | Enrolled fleets / programs — far smaller |
| Legal gate | Owner consent + DPIA for intruder data | Same, plus enrollment consent |
| Capability gate | Sandbox limits are permanent | Provisioning opens most of it |
| Distribution gate | Standard Play review (anti-theft is allowed) | Not a normal Play consumer listing |
| Backend | **Already built — F-A/F-B/F-C serve both unchanged** | Same backend; a different client |
| Status | Shipping path | Would be a second product line |

The backend already built (device tokens, evidence ingest, episodes, the signed
pack, buddy alerts) is **tier-agnostic** — it receives whatever the client can
capture. Choosing a tier changes the Android app and the go-to-market, not the
server.

---

## 6. Recommendation

1. **Ship the consumer edition as the primary product.** Its honest value —
   failed-unlock detection, a background location trail, and the signed,
   insurer-ready evidence pack delivered to the owner and their buddies — is
   real, defensible, and the part Google's OS does *not* do. It does not depend
   on depth the platform forbids.
2. **Keep the marketing claims inside the consumer tier's real capability.**
   (This is also the current website-copy fix: no silent background camera, no
   "beat the wipe" — the triage marks both impossible on this tier.)
3. **Treat Device-Owner Tambo as a deliberate second product**, pursued only
   with a concrete enrolled-device customer (an NGO, a program, a pilot). It is
   the *only* lawful, consented route to the depth the brief describes — and it
   is a business decision about market and enrollment friction, not a consent-
   wording or an engineering decision.

The question "how deep can Tambo go?" has a clean answer: **as deep as the tier
it is installed into allows — and the tier is chosen before any code, not
unlocked by a better consent screen afterward.**
