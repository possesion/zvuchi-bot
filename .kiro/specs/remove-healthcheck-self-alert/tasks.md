# Implementation Plan

- [x] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - No Self-Alert on Healthcheck Failure
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate the self-referential alert bug exists
  - **Scoped PBT Approach**: Generate varied failure messages for the healthcheck failure case; property holds for all inputs where `isBugCondition` is true (i.e., `checkTelegramApi()` throws)
  - Create `src/healthcheck.bugcondition.test.js` using Jest + fast-check
  - Stub `checkTelegramApi()` / `fetch` to throw (DNS failure, timeout, `AggregateError`, `502`) so `handleHealthcheck()` enters the failure path
  - Spy on the alert delivery path (mock `https.request`) and observe alert-related log lines
  - Assert: on failure the handler responds HTTP 503 with `{ status: 'error', message }`, logs "[healthcheck] ОШИБКА: <message>", and does NOT attempt any outbound alert request and does NOT mutate `alertSent` state (from Bug Condition / `isBugCondition` in design)
  - Also cover the state-dependent cases: two consecutive failures behave identically (second must not be suppressed), and a failure→success sequence produces no "Восстановление после сбоя" reset log
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS (this is correct - it proves the bug exists: an alert request is attempted / `alertSent` is mutated)
  - Document counterexamples found (e.g., "healthcheck failure attempts outbound request to api.telegram.org and logs 'Ошибка ... алерта'; second consecutive failure suppresses alert via alertSent")
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Success, Error Response, and Routing Unchanged
  - **IMPORTANT**: Follow observation-first methodology
  - Create `src/healthcheck.preservation.test.js` using Jest + fast-check
  - Observe behavior on UNFIXED code for non-bug-condition inputs (cases where `isBugCondition` returns false):
    - Successful `checkTelegramApi()` yields HTTP 200 `{ status: 'ok' }` and logs "[healthcheck] OK"
    - Failure yields HTTP 503 `{ status: 'error', message }` and logs "[healthcheck] ОШИБКА: <message>" (the response/log shape itself, independent of alert side effects)
    - `/users` returns 200 with user list (500 on DB error)
    - `/sync` returns 200 on success, 503 when bot is missing, 500 on error
    - Unknown paths return 404
  - Write property-based tests capturing observed behavior patterns from the Preservation Requirements: generate varied non-failure requests (success, `/users`, `/sync`, unknown paths) and varied failure messages, asserting responses/logs match observed behavior and depend only on the current request, not on retained state
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 3. Fix for self-referential healthcheck alert (remove sendAlert and alertSent)

  - [x] 3.1 Implement the fix
    - Remove the module-level `let alertSent = false;` declaration and its explanatory comment
    - Remove the entire `sendAlert(message)` function and its JSDoc block (this removes the only reads of `ALERT_BOT_TOKEN` and `ALERT_CHAT_ID`)
    - In `handleHealthcheck` success path: remove the `if (alertSent) { ... }` recovery block (including the "Восстановление после сбоя" log); keep the "[healthcheck] OK" log and the 200 response with `{ status: 'ok' }`
    - In `handleHealthcheck` failure path: remove the `if (!alertSent) { sendAlert(message); alertSent = true; }` block; keep computing `message`, logging "[healthcheck] ОШИБКА: <message>", and responding 503 with `{ status: 'error', message }`
    - Remove the now-unused `const https = require('node:https');` import after verifying no other function references `https`
    - Leave `checkTelegramApi`, `handleUsers`, `handleSync`, `startHealthcheckServer`, and routing untouched
    - _Bug_Condition: isBugCondition(input) = checkTelegramApiThrows(input) AND (alertDeliveryAttempted OR alertSentStateMutated) from design_
    - _Expected_Behavior: on failure respond 503 + `{ status: 'error', message }`, log "[healthcheck] ОШИБКА: <message>", no alert delivery, no alertSent state (Property 1 from design)_
    - _Preservation: Preservation Requirements from design — 200 success, 503 error shape, `/users`, `/sync`, and routing unchanged_
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 3.2 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - No Self-Alert on Healthcheck Failure
    - **IMPORTANT**: Re-run the SAME test from task 1 - do NOT write a new test
    - The test from task 1 encodes the expected behavior
    - When this test passes, it confirms the expected behavior is satisfied (503 + error log, no alert attempt, no `alertSent` mutation)
    - Run bug condition exploration test from step 1
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed)
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 3.3 Verify preservation tests still pass
    - **Property 2: Preservation** - Success, Error Response, and Routing Unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - Run preservation property tests from step 2
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions in 200 success, 503 shape, `/users`, `/sync`, routing)
    - Confirm all tests still pass after fix (no regressions)
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 4. Checkpoint - Ensure all tests pass
  - Run the full suite with `npm test` and ensure all tests pass
  - Confirm `sendAlert` and `alertSent` are no longer present/reachable in `src/healthcheck.js`
  - Confirm no "Ошибка ... алерта" or "Восстановление после сбоя" log lines are emitted on any path
  - Ask the user if questions arise
