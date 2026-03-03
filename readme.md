# Crisp Technical Assessment

A working POC for **Magic Link Authentication** (Exercise 1) backed by a locally-hosted Supabase/Postgres instance, plus written answers for all exercises.

## Quick Start

```bash
supabase start        # Start local Postgres (requires Docker)
npm install           # Install dependencies
npm start             # Start server at http://localhost:3000
npm test              # Run end-to-end tests (server must be running)
```

## What's Implemented

| Feature | Endpoint | Description |
|---|---|---|
| Request magic link (DB) | `POST /api/magic-link/request` | Generates token, stores SHA-256 hash in Postgres |
| Verify magic link (DB) | `GET /api/magic-link/verify?token=...` | Atomic claim, single-use, creates session |
| Request magic link (HMAC) | `POST /api/magic-link/stateless/request` | Generates HMAC-signed token, no DB write |
| Verify magic link (HMAC) | `GET /api/magic-link/stateless/verify?token=...` | Verifies signature, no DB read |

## Answers

See **[ANSWERS.md](ANSWERS.md)** for detailed responses to all exercises (1a–1e, 2a–2c).
