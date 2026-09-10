# Bugfix Requirements Document

## Introduction

The healthcheck module (`src/healthcheck.js`) exposes a `sendAlert()` function that reports healthcheck failures by sending a message through the Telegram API (`api.telegram.org/bot<ALERT_BOT_TOKEN>/sendMessage`). It is invoked from `handleHealthcheck()` whenever `checkTelegramApi()` fails.

The design is self-referential: the healthcheck fails precisely when the Telegram API is unreachable (DNS failures such as `getaddrinfo EAI_AGAIN`, timeouts, `AggregateError`, or `502 Bad Gateway`), yet `sendAlert()` tries to notify through the *same* `api.telegram.org` host. As a result, alert delivery fails in exactly the situation it is meant to report. Observed log symptoms include "[healthcheck] Ошибка HTTPS при отправке алерта:" (network error), "[healthcheck] Ошибка отправки алерта: HTTP 400" (alert bot rejects the request), and "[healthcheck] ОШИБКА: fetch failed" co-occurring with polling `EFATAL` errors.

The decision is to remove the `sendAlert` logic entirely, along with the supporting single-shot `alertSent` state, since self-referential alerting through the same unreachable API is unreliable. The 503 error response and error logging in `handleHealthcheck()` must be preserved. As a consequence, the environment variables `ALERT_BOT_TOKEN` and `ALERT_CHAT_ID` become unused.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN `checkTelegramApi()` fails because `api.telegram.org` is unreachable (DNS failure, timeout, `AggregateError`, or `502`) THEN the system calls `sendAlert()`, which attempts delivery through the same unreachable `api.telegram.org` host and fails with a network error, logging "[healthcheck] Ошибка HTTPS при отправке алерта:".

1.2 WHEN `checkTelegramApi()` fails and the Alert Bot request is delivered but rejected THEN the system logs "[healthcheck] Ошибка отправки алерта: HTTP 400", producing a misleading failure alert that adds no diagnostic value.

1.3 WHEN a healthcheck failure occurs THEN the system maintains the in-memory `alertSent` state and its reset-on-recovery logic solely to support single-shot alerting, which becomes dead complexity once the unreliable alert delivery is removed.

### Expected Behavior (Correct)

2.1 WHEN `checkTelegramApi()` fails because `api.telegram.org` is unreachable THEN the system SHALL NOT attempt to send any alert through the Telegram API and SHALL produce no alert-related log entries.

2.2 WHEN `checkTelegramApi()` fails and the Alert Bot would previously have been rejected THEN the system SHALL NOT attempt alert delivery, eliminating the "Ошибка отправки алерта" log path entirely.

2.3 WHEN a healthcheck failure occurs THEN the system SHALL NOT track any `alertSent` state, and the reset-on-recovery logic SHALL be removed as dead code.

### Unchanged Behavior (Regression Prevention)

3.1 WHEN `checkTelegramApi()` succeeds THEN the system SHALL CONTINUE TO respond with HTTP 200 and body `{ "status": "ok" }` and log "[healthcheck] OK".

3.2 WHEN `checkTelegramApi()` fails THEN the system SHALL CONTINUE TO respond with HTTP 503 and body `{ "status": "error", "message": <message> }` and log "[healthcheck] ОШИБКА: <message>".

3.3 WHEN a request hits `/users` or `/sync` THEN the system SHALL CONTINUE TO handle it exactly as before.

3.4 WHEN the healthcheck HTTP server starts THEN the system SHALL CONTINUE TO listen on the configured port and route `/healthcheck`, `/users`, `/sync`, and unknown paths unchanged.
