# Test todo list for the S08b review fixes

The S08b review checklist below is covered by regression tests. Feature code was left unchanged. The `server/http` suite and the full local gate pass; the full-suite result was 839 passed and 1 skipped. Do not change feature code to make a test pass; if a future test shows a real bug, write it up here and tell the feature owner.

## 1. `server/http/rate-limit.test.ts`: new `refund` and `startSweeper`

- [x] `refund(key)` after an allowed `check` gives the slot back: with `max: 1`, `check` allowed, `refund`, `check` allowed again.
- [x] `refund` on an unknown key, or a key with no live hits, does nothing and does not throw.
- [x] `refund` removes only the most recent hit: with `max: 3` and three checks, one `refund` leaves `peek().remaining === 0` after the next allowed check, not full.
- [x] `refund` deletes the key when its last hit goes (`size()` returns 0).
- [x] `startSweeper` (use `vi.useFakeTimers`): after the window passes and one interval fires, `size()` drops to 0 without any `check` call.
- [x] The function it returns stops the timer (no further sweeps after calling it).

## 2. `server/http/film-limit.test.ts`: quota is charged only for a film that started

Use a handler in the test app that returns a chosen status.

- [x] A 202 response uses a slot: with `max: 1`, the second POST gets 429.
- [x] A 400 (invalid upload) gives the slot back: with `max: 1`, POST 400 then POST 202 both get through.
- [x] A 429 `busy` from the handler (queue full) gives the slot back.
- [x] A handler that throws (500) gives the slot back, and the error still reaches the client.
- [x] Simultaneous requests: fire `max + 2` requests with `Promise.all` at a handler that waits a tick; exactly `max` are admitted (the slot is reserved before the handler runs).
- [x] The rate-limited log line now reads `limit=<max>/hour retryAfterSec=<n>`. Update the regex in "logs a hashed key, never the address" if it needs it, and assert the old `window=3/3` text is gone.
- [x] A visitor with a refunded slot does not get a longer Retry-After than one who never posted.

## 3. `server/http/generate-cap.test.ts`: approvals that start nothing do not use the budget

- [x] A 2xx approval uses the budget (`max: 1`, second approval gets 429 `generate_cap`).
- [x] A 4xx approval (unknown film, wrong scene state, busy) gives the slot back.
- [x] A throwing handler gives the slot back.
- [x] The cap stays global: two different client addresses share the one budget (documented as intended in the file header).
- [x] Non-approve paths and non-POST methods are untouched (existing tests must still pass).

## 4. `server/http/client-ip.test.ts`: warnings

Spy on `console.warn`. The warning set is module level, so use `vi.resetModules()` and re-import per test.

- [x] `FLY_APP_NAME` set and `trustFlyHeader: false`: warns once about `TRUST_FLY_CLIENT_IP`, and a second call does not warn again.
- [x] `FLY_APP_NAME` set and `trustFlyHeader: true` with a `fly-client-ip` header: no warning, returns the header value.
- [x] `FLY_APP_NAME` unset: no warning.
- [x] `NODE_ENV=production` and no connection info (`app.request`): returns `'unknown'` and warns once. `NODE_ENV=test`: returns `'unknown'` with no warning.
- [x] Restore `process.env` in `afterEach`.

## 5. `server/http/film-queue-install.test.ts`: boot hook

- [x] `loadDirector` rejects with `new Error('boom')`: the log contains `director failed to load: boom`, and the hook still logs `director not available; skipping requeue` and does not throw.
- [x] `loadDirector` resolves a module with no `runDirector`: only the "not available" line, no "failed to load" line.
- [x] Requeue ordering: three `new` films with different `createdAt` are submitted oldest first.

## 6. Guard tests for two findings that turned out not to be bugs

The review reported these as bugs. Reading the code shows the existing guards already cover them, so they only need regression tests.

- [x] Requeue cannot start a film twice (`film-queue-install.test.ts` plus `film-queue.test.ts`). `queue.submit` ignores a film id that is already running or queued. Test: a film is running through the queue while its status is still `new`; the boot requeue lists it and submits it again; `run` was called once, and the second `submit` returned `running` or the queued position.
- [x] A full queue between `canAccept` and `submit` does not leave a film stuck in `new` (`server/http/routes-films-chat.test.ts`, route level). Use an admission fake where `canAccept` returns ok and `submit` returns `rejected`: the response is 429 with a `Retry-After` header, the film's status is `failed`, and an `error` event with `where: 'admission'` was emitted.

## 7. Cross-cutting

- [x] `server/http/middleware.chain.test.ts`: through the real chain, a rejected create (bad body) does not use a film slot, and a successful create does. The passcode still runs first, so a wrong passcode uses no slot either.
- [x] Run the full gate when done: `npm run typecheck`, `npm run lint`, `npx vitest run`.

## Not covered here (open feature work, no fix yet)

- S05b blank-frame weaknesses: `isFlatSignature` and the server `isFlatImage` treat a solid card or a fade-to-black as blank; `visual.ts` swallows decode errors (`.catch(() => false)`) and drops blank frames without saying how many. When that is fixed, add tests for a legitimate solid frame, a corrupt frame, and the dropped-frame count in the `blank-frames` error.
- Timer churn in `film-queue.ts` `pump` (re-arms the timer on every call). Harmless, left alone.
