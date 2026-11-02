---
name: add-api-endpoint
description: Add or modify an /api HTTP route in server.js with correct auth, errors, and a test. Use when a new endpoint is requested or an existing one is wrong.
---

# Add an API endpoint

The local API is defined in `server.js` and documented in `docs/api.md`. **Before writing, open
`docs/api.md`** — if the endpoint you think you're adding already exists, match its exact shape
instead of inventing a second one.

## Guardrails (from `allowed()` in `server.js:96`)

- The server only answers this machine. **Writes (POST/PUT/PATCH/DELETE) require the `x-qt: 1`
  header** and, if `Origin` is present, it must match `Host`. Reads (GET/HEAD) need nothing.
- Do **not** add open CORS, a remote-exec flag, an admin surface, or any outbound call beyond
  what `lib/providers.js` already does.

## Shape a new route

1. **Pick the verb + path.** Reads = `GET`. Anything that mutates `data/` = a write verb with
   the `x-qt` header. Keep naming consistent with the existing `/api/*` table in `docs/api.md`.
2. **Use the existing helpers** rather than writing fresh plumbing:
   - `send(res, status, body, headers)` for responses (string→text, object→JSON).
   - `readBody(req, limit)` for JSON bodies (throws 400/413 for you).
   - `httpError(status, message)` / throwing an object with a `.status` property → becomes
     `{"error": "..."}` with the right code. Don't `return` raw errors.
3. **Reads:** validate query params, resolve the symbol (`lib/providers.js`), compute, `send()`
   the JSON. Keep `limit`/bounds on list endpoints (the existing ones cap at, e.g. 2000 bars, 200
   symbols).
4. **Writes:** pull state through `lib/store.js` (`data/*.json`), mutate, save, respond. Never
   hand-edit `data/` files.
5. **Document it.** Add the row to the `docs/api.md` table in the same commit.

## Test it

- Add a case to `test/server.test.js` (it spins up the real server). For a write endpoint,
  include the `x-qt: 1` header in the request and assert the response body **and** that the state
  file changed.
- If you add a new test file, add it to the `test` script in `package.json`.

## Verify

```
npm test
npm run check    # READY = offline tests + doctor + smoke all pass
```

## Pitfalls

- Forgetting the `x-qt: 1` header in a test → the request is silently rejected (401/403), which
  looks like a bug in your handler.
- Using relative imports without the `.js` extension → ESM fails at runtime.
- Returning `undefined` instead of `send()`ing → the client hangs with no status.
- Adding state writes that bypass `lib/store.js` → you'll drift from the UI's view of the world.
