# Tambo Backend

Mobile app backend: **Express + TypeScript + Mongoose**, with JWT access tokens
and rotating refresh tokens.

## Quick start

```bash
npm install
cp .env.example .env          # then fill in MONGODB_URI and JWT_ACCESS_SECRET
npm run dev                   # http://localhost:3000
```

Generate a secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Check it came up:

```bash
curl localhost:3000/api/health
```

## Scripts

| Script | Does |
|---|---|
| `npm run dev` | Watch mode via nodemon + ts-node |
| `npm run build` | Compile `src/` to `dist/` |
| `npm start` | Run the compiled server |
| `npm test` | Jest against a real in-memory MongoDB |
| `npm run typecheck` | Type-check `src/` **and** `tests/`, no emit |
| `npm run lint` / `lint:fix` | ESLint |
| `npm run format` / `format:check` | Prettier |

## Documentation

- [docs/architecture.md](docs/architecture.md) — layering, conventions, how a request flows
- [docs/auth-api.md](docs/auth-api.md)
- [docs/devices-api.md](docs/devices-api.md) — devices, theft episodes, trusted contacts (F-A)
- [docs/evidence-api.md](docs/evidence-api.md) — evidence ingest: envelopes, media, retention (F-B) — endpoint reference and error codes
- [docs/evidence-features-plan.md](docs/evidence-features-plan.md) — the next three features: devices/episodes, evidence ingest, pack & delivery
- [docs/cloudflare.md](docs/cloudflare.md) — operator runbook: Resend DNS, proxying, TRUST_PROXY
- [docs/security.md](docs/security.md) — the threat model and what defends against what
- [docs/roadmap.md](docs/roadmap.md) — build plan & status: what is done, what is next, open decisions

## Testing

Tests run against a real MongoDB (`mongodb-memory-server`), not mocks — index
constraints, TTL behaviour and query semantics are therefore actually exercised.
One server is started per run and each jest worker uses its own database.

On macOS 12 and older the default MongoDB 8.x binary will not run; the suite
pins 6.0.14. Override with `MONGOMS_VERSION` where a newer build is fine (a
Linux CI runner, for example).

## Requirements

Node 20+, and a MongoDB instance for anything other than running the tests.
