# Remove Healthcheck Self-Alert Bugfix Design

## Overview

The healthcheck module (`src/healthcheck.js`) attempts to report healthcheck failures by sending a Telegram message through `api.telegram.org`. This is self-referential: the healthcheck fails precisely when the Telegram API is unreachable, so the alert delivery attempt uses the same broken host and fails in exactly the situation it is meant to report. This produces misleading log noise ("Ошибка HTTPS при отправке алерта", "Ошибка отправки алерта: HTTP 400") with no diagnostic value.

The fix removes the `sendAlert()` function entirely, along with the in-memory single-shot `alertSent` state and its reset-on-recovery logic. The failure path in `handleHealthcheck()` is reduced to logging the error and responding with HTTP 503. All other behavior — the 200 success path, the 503 error response, the error log line, and the `/users`, `/sync`, and routing behavior — is preserved unchanged. As a consequence, the `ALERT_BOT_TOKEN` and `ALERT_CHAT_ID` environment variables become unused (no code change required for their removal; they are simply no longer read).

## Glossary

- **Bug_Condition (C)**: The condition that triggers the bug — a healthcheck failure (`checkTelegramApi()` throws) that causes `handleHealthcheck()` to invoke self-referential alert logic (`sendAlert()` and `alertSent` state management).
- **Property (P)**: The desired behavior on a healthcheck failure — respond with HTTP 503 and the error body, log "[healthcheck] ОШИБКА: <message>", and perform NO alert delivery and NO alert-state tracking.
- **Preservation**: Existing behavior that must remain unchanged — the 200 success response, the 503 error response shape, the error log line, and the `/users`, `/sync`, and path-routing behavior.
- **checkTelegramApi**: The function in `src/healthcheck.js` that verifies Telegram API reachability via `getMe`; throws on any failure.
- **handleHealthcheck**: The function in `src/healthcheck.js` that handles `GET /healthcheck`, calling `checkTelegramApi()` and responding 200 on success or 503 on failure.
- **sendAlert**: The function in `src/healthcheck.js` (to be removed) that attempts to POST an alert message to `api.telegram.org` via the Alert Bot.
- **alertSent**: The module-level boolean (to be removed) tracking whether a single-shot alert has already been sent for the current outage.

## Bug Details

### Bug Condition

The bug manifests when `handleHealthcheck()` processes a request while `checkTelegramApi()` fails (the Telegram API is unreachable: DNS failure, timeout, `AggregateError`, or `502`). In this state the handler invokes `sendAlert()` — which attempts delivery through the same unreachable `api.telegram.org` host — and mutates the module-level `alertSent` state. The alert attempt fails or is rejected, adding misleading log noise with no diagnostic value, and the `alertSent` state exists only to support this unreliable alerting.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type HealthcheckRequest
  OUTPUT: boolean

  RETURN checkTelegramApiThrows(input) == true
         AND (alertDeliveryAttempted(input) == true
              OR alertSentStateMutated(input) == true)
END FUNCTION
```

### Examples

- **DNS failure**: `checkTelegramApi()` throws `getaddrinfo EAI_AGAIN api.telegram.org`. Expected: log "[healthcheck] ОШИБКА: ..." and respond 503, no alert. Actual: additionally logs "[healthcheck] Ошибка HTTPS при отправке алерта:" from the failed `sendAlert()`.
- **Alert Bot rejection**: `checkTelegramApi()` throws, the Alert Bot request is delivered but rejected. Expected: log the error and respond 503, no alert. Actual: additionally logs "[healthcheck] Ошибка отправки алерта: HTTP 400".
- **Repeated failures**: two consecutive failures. Expected: both log the error and respond 503 identically. Actual: first mutates `alertSent = true` and attempts an alert, second suppresses the alert due to `alertSent` — behavior depends on hidden state.
- **Edge case — recovery**: a failure followed by a success. Expected: success responds 200 and logs "[healthcheck] OK". Actual: success additionally resets `alertSent` and logs "[healthcheck] Восстановление после сбоя — Alert State сброшен".

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- On healthcheck success, respond HTTP 200 with body `{ "status": "ok" }` and log "[healthcheck] OK".
- On healthcheck failure, respond HTTP 503 with body `{ "status": "error", "message": <message> }` and log "[healthcheck] ОШИБКА: <message>".
- `/users` handling (DB query, 200 with user list, 500 on error) remains exactly as before.
- `/sync` handling (schedule sync, 200 on success, 503 when bot is missing, 500 on error) remains exactly as before.
- HTTP server startup, port selection, and routing for `/healthcheck`, `/users`, `/sync`, and unknown paths (404) remain exactly as before.

**Scope:**
All inputs that do NOT involve a healthcheck failure invoking alert logic should be completely unaffected by this fix. This includes:
- Successful `/healthcheck` requests
- All `/users` requests
- All `/sync` requests
- Requests to unknown paths (404 responses)

## Hypothesized Root Cause

Based on the bug description, the issue is a design flaw rather than a coding defect:

1. **Self-referential alert channel**: `sendAlert()` posts to `api.telegram.org`, the same host whose unreachability triggers the healthcheck failure. When the alert is most needed, its delivery channel is guaranteed to be down.
   - Network-layer failure surfaces as "[healthcheck] Ошибка HTTPS при отправке алерта:".
   - Application-layer rejection surfaces as "[healthcheck] Ошибка отправки алерта: HTTP 400".

2. **Dead complexity from single-shot state**: The module-level `alertSent` boolean and its reset-on-recovery logic exist only to throttle the unreliable alert. Once alerting is removed, this state and its branches are dead code that complicate the handler and couple behavior to hidden module state.

3. **Unused environment variables**: `ALERT_BOT_TOKEN` and `ALERT_CHAT_ID` are read only by `sendAlert()`; removing the function leaves them unused.

## Correctness Properties

Property 1: Bug Condition - No Self-Alert on Healthcheck Failure

_For any_ input where the bug condition holds (isBugCondition returns true — a healthcheck request while `checkTelegramApi()` fails), the fixed `handleHealthcheck` function SHALL respond with HTTP 503 and body `{ "status": "error", "message": <message> }`, log "[healthcheck] ОШИБКА: <message>", and SHALL NOT attempt any alert delivery and SHALL NOT read or mutate any `alertSent` state, producing no alert-related log entries.

**Validates: Requirements 2.1, 2.2, 2.3**

Property 2: Preservation - Success, Error Response, and Routing Unchanged

_For any_ input where the bug condition does NOT hold (isBugCondition returns false — a successful healthcheck, or a `/users`, `/sync`, or unknown-path request), the fixed function SHALL produce the same result as the original function, preserving the HTTP 200 success response and "[healthcheck] OK" log, the HTTP 503 error response shape, `/users` and `/sync` handling, and path routing including 404s.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

**File**: `src/healthcheck.js`

**Functions**: `handleHealthcheck` (modified), `sendAlert` (removed); module-level `alertSent` (removed)

**Specific Changes**:
1. **Remove the `alertSent` state**: Delete the module-level `let alertSent = false;` declaration and its explanatory comment.

2. **Remove the `sendAlert` function**: Delete the entire `sendAlert(message)` function and its JSDoc block. This also removes the only reads of `ALERT_BOT_TOKEN` and `ALERT_CHAT_ID`.

3. **Simplify the success path in `handleHealthcheck`**: Remove the `if (alertSent) { ... }` recovery block (including the "Восстановление после сбоя" log). Keep the "[healthcheck] OK" log and the 200 response with `{ status: 'ok' }`.

4. **Simplify the failure path in `handleHealthcheck`**: Remove the `if (!alertSent) { sendAlert(message); alertSent = true; }` block. Keep computing `message`, logging "[healthcheck] ОШИБКА: <message>", and responding 503 with `{ status: 'error', message }`.

5. **Remove the now-unused `https` import**: `sendAlert` was the only consumer of `require('node:https')`; remove that require line. Verify no other function references `https` before removing.

6. **Leave `checkTelegramApi`, `handleUsers`, `handleSync`, `startHealthcheckServer`, and routing untouched.**

7. **Environment variables**: `ALERT_BOT_TOKEN` and `ALERT_CHAT_ID` become unused. No code change is required; optionally note them as deprecated in project docs/`.env` (out of scope for the code fix).

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on the unfixed code (alert logic runs on failure), then verify the fix removes all alert behavior while preserving the success response, the 503 error response, and the `/users`, `/sync`, and routing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm or refute the root cause: that a healthcheck failure triggers `sendAlert()` and mutates `alertSent`. If refuted, re-hypothesize.

**Test Plan**: Stub `checkTelegramApi()` to throw and spy on the alert path (e.g., mock `https.request` / observe alert log lines) and on the `alertSent`-driven behavior. Run against the UNFIXED code to observe that an alert delivery is attempted and that behavior differs between the first and second failure.

**Test Cases**:
1. **Failure attempts alert**: Force `checkTelegramApi()` to throw and assert an outbound alert request is attempted (will fail/expose the bug on unfixed code).
2. **Alert-error log path**: Force the alert request to error/reject and assert the "Ошибка ... алерта" log path is exercised (will fail on unfixed code).
3. **State-dependent behavior**: Fire two consecutive failures and assert the second suppresses the alert due to `alertSent` (demonstrates hidden-state coupling on unfixed code).
4. **Edge case — recovery reset**: Fire a failure then a success and assert the "Восстановление после сбоя" reset log occurs (demonstrates dead-code path on unfixed code).

**Expected Counterexamples**:
- An outbound alert request to `api.telegram.org` is attempted on healthcheck failure.
- Possible causes: self-referential alert channel, single-shot `alertSent` state, alert-error logging branches.

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior (503 + error log, no alert, no state).

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := handleHealthcheck_fixed(input)
  ASSERT result.statusCode == 503
  ASSERT result.body == { status: 'error', message: <message> }
  ASSERT errorLogged("[healthcheck] ОШИБКА: " + message)
  ASSERT NOT alertDeliveryAttempted(result)
  ASSERT NOT alertStateMutated(result)
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT handleHealthcheck_original(input) = handleHealthcheck_fixed(input)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain (success responses, `/users`, `/sync`, unknown paths).
- It catches edge cases that manual unit tests might miss.
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs.

**Test Plan**: Observe behavior on UNFIXED code first for successful healthchecks and for `/users`, `/sync`, and unknown-path requests, then write property-based tests capturing that behavior and re-run against the fixed code.

**Test Cases**:
1. **Success response preservation**: Observe that a successful `checkTelegramApi()` yields 200 `{ status: 'ok' }` and "[healthcheck] OK" on unfixed code, then verify this continues after fix.
2. **503 error response preservation**: Observe that a failure yields 503 `{ status: 'error', message }` and "[healthcheck] ОШИБКА: <message>" on unfixed code, then verify this continues after fix (minus the alert side effects).
3. **`/users` and `/sync` preservation**: Observe `/users` and `/sync` responses (including 503 when bot missing) on unfixed code, then verify unchanged after fix.
4. **Routing preservation**: Observe that unknown paths return 404 on unfixed code, then verify unchanged after fix.

### Unit Tests

- Healthcheck failure responds 503 with correct body and error log, and performs no alert delivery.
- Healthcheck success responds 200 with `{ status: 'ok' }` and logs "[healthcheck] OK".
- `sendAlert` and `alertSent` are no longer present/reachable in the module.

### Property-Based Tests

- Generate varied failure messages and assert 503 body/log invariants hold with no alert attempt (fix checking).
- Generate varied non-failure requests (success, `/users`, `/sync`, unknown paths) and assert responses match original behavior (preservation checking).
- Generate sequences of mixed success/failure requests and assert responses depend only on the current request, not on any retained state.

### Integration Tests

- Full server flow: start the server, hit `/healthcheck` under simulated API-up and API-down conditions, assert 200 / 503 and absence of alert log lines.
- Context/route switching: hit `/users`, `/sync`, and an unknown path against the running server and assert unchanged responses.
- Log verification: assert no "Ошибка ... алерта" or "Восстановление после сбоя" lines are emitted on any path after the fix.
