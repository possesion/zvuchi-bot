# Requirements Document

## Introduction

Система мониторинга для Telegram-бота Zvuchi реализует HTTP-эндпоинт `/healthcheck`, который проверяет доступность Telegram API и отправляет алерты через отдельный бот при обнаружении сбоя. Эндпоинт совместим со стандартными HTTP-мониторами (UptimeRobot и аналогичными). Реализация не использует базу данных и не требует новых npm-зависимостей — только встроенный модуль `node:http`.

## Glossary

- **Healthcheck Server**: HTTP-сервер на базе встроенного `node:http`, обрабатывающий запросы к `/healthcheck`.
- **Telegram API Check**: Лёгкий запрос к Telegram API (метод `getMe`) для проверки доступности основного бота.
- **Alert Bot**: Отдельный Telegram-бот, настроенный через `ALERT_BOT_TOKEN` и `ALERT_CHAT_ID`, используемый исключительно для отправки алертов.
- **Incident**: Состояние системы, при котором проверка Telegram API завершилась неудачей и успешного `/healthcheck` ещё не было.
- **Alert State**: Флаг в памяти процесса, фиксирующий, был ли уже отправлен алерт для текущего инцидента.
- **Main Bot**: Основной бот Zvuchi (`API_KEY_BOT`), обслуживающий студентов.

## Requirements

### Requirement 1: HTTP-сервер для healthcheck

**User Story:** As a DevOps engineer, I want an HTTP endpoint at `/healthcheck`, so that external monitoring services can probe bot availability.

#### Acceptance Criteria

1. THE Healthcheck Server SHALL listen on a configurable port defined by the `HEALTHCHECK_PORT` environment variable, defaulting to `3000` when the variable is absent.
2. WHEN a GET request is received at the path `/healthcheck`, THE Healthcheck Server SHALL process the health probe.
3. WHEN a request is received at any path other than `/healthcheck`, THE Healthcheck Server SHALL respond with HTTP status `404`.
4. THE Healthcheck Server SHALL start independently of the Telegram bot polling process within the same Node.js process.

---

### Requirement 2: Проверка доступности Telegram API

**User Story:** As a DevOps engineer, I want the healthcheck to verify that the Telegram API is reachable, so that I receive accurate availability signals.

#### Acceptance Criteria

1. WHEN a GET request is received at `/healthcheck`, THE Healthcheck Server SHALL call the Telegram Bot API `getMe` method using the `API_KEY_BOT` token.
2. WHEN the `getMe` call completes successfully, THE Healthcheck Server SHALL respond with HTTP status `200` and a JSON body `{"status":"ok"}`.
3. IF the `getMe` call throws an error or returns a non-ok response, THEN THE Healthcheck Server SHALL respond with HTTP status `503` and a JSON body `{"status":"error","message":"<error description>"}`.
4. THE Healthcheck Server SHALL set the `Content-Type: application/json` response header for all `/healthcheck` responses.

---

### Requirement 3: Отправка алерта при сбое

**User Story:** As a bot operator, I want to receive a Telegram notification when the bot becomes unreachable, so that I can respond to outages promptly.

#### Acceptance Criteria

1. WHEN the `getMe` check fails and the Alert State is `false`, THE Alert Bot SHALL send a text message to `ALERT_CHAT_ID` containing the error description.
2. WHEN the `getMe` check fails and the Alert State is `true`, THE Alert Bot SHALL NOT send a repeated alert message.
3. WHEN the `getMe` check fails, THE Healthcheck Server SHALL set the Alert State to `true`.
4. THE Alert Bot SHALL send alert messages using the `ALERT_BOT_TOKEN` token via a direct HTTPS request to the Telegram Bot API, without using any npm packages.

---

### Requirement 4: Сброс состояния после восстановления

**User Story:** As a bot operator, I want the alert state to reset after a successful healthcheck, so that I receive exactly one alert per incident.

#### Acceptance Criteria

1. WHEN the `getMe` check succeeds and the Alert State is `true`, THE Healthcheck Server SHALL set the Alert State to `false`.
2. WHEN the `getMe` check succeeds and the Alert State is `false`, THE Healthcheck Server SHALL leave the Alert State unchanged.
3. THE Alert Bot SHALL NOT send any message during a successful healthcheck.

---

### Requirement 5: Конфигурация через переменные окружения

**User Story:** As a developer, I want all sensitive configuration kept in `.env`, so that credentials are not hardcoded in source files.

#### Acceptance Criteria

1. THE Healthcheck Server SHALL read `ALERT_BOT_TOKEN` from environment variables to authenticate the Alert Bot.
2. THE Healthcheck Server SHALL read `ALERT_CHAT_ID` from environment variables to determine the alert recipient.
3. IF `ALERT_BOT_TOKEN` or `ALERT_CHAT_ID` is absent at startup, THEN THE Healthcheck Server SHALL log a warning and skip alert delivery without crashing.
4. THE Healthcheck Server SHALL read `HEALTHCHECK_PORT` from environment variables to determine the listening port.

---

### Requirement 6: Изоляция от базы данных

**User Story:** As a developer, I want the healthcheck module to have no dependency on the database layer, so that a database failure does not affect monitoring accuracy.

#### Acceptance Criteria

1. THE Healthcheck Server SHALL NOT import or call any functions from `src/database.js`.
2. THE Healthcheck Server SHALL NOT read from or write to `bot.db` at any point during a healthcheck probe.
