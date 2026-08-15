# Design Document

## Feature: bot-healthcheck-monitoring

## Overview

Модуль `src/healthcheck.js` реализует HTTP-сервер на базе встроенного `node:http`. Сервер принимает GET-запросы на `/healthcheck`, проверяет доступность основного бота через `getMe`, и при обнаружении сбоя — однократно отправляет алерт через отдельный Alert Bot напрямую в Telegram API. Alert State хранится в памяти процесса (in-memory boolean). Модуль не имеет зависимостей от базы данных и не требует новых npm-пакетов.

---

## Architecture

### Component Diagram

```
index.js
  ├── TelegramBot (polling)
  ├── cron schedule (notifications)
  └── startHealthcheckServer()   ← new
        └── src/healthcheck.js
              ├── node:http  (HTTP server)
              ├── node:https (alert delivery)
              └── fetch / node:https (getMe check)
```

### Separation of Concerns

| Компонент | Ответственность |
|-----------|-----------------|
| `src/healthcheck.js` | HTTP-сервер, проверка getMe, управление Alert State, отправка алертов |
| `index.js` | Запуск сервера после инициализации бота |
| `.env` | `HEALTHCHECK_PORT`, `ALERT_BOT_TOKEN`, `ALERT_CHAT_ID`, `API_KEY_BOT` |

---

## Module Design: `src/healthcheck.js`

### State

```javascript
// In-memory alert state — сбрасывается только при успешном healthcheck
let alertSent = false;
```

### Exported API

```javascript
/**
 * Запускает HTTP-сервер для healthcheck.
 * @param {number} [port] - порт для прослушивания (по умолчанию HEALTHCHECK_PORT || 3000)
 * @returns {http.Server}
 */
function startHealthcheckServer(port) { ... }

module.exports = { startHealthcheckServer };
```

### Request Routing

```
GET /healthcheck  → handleHealthcheck(req, res)
*               → res.writeHead(404); res.end()
```

### `handleHealthcheck(req, res)` — Flow

```
1. await checkTelegramApi()
   ├── success → alertSent && (alertSent = false)
   │            → respond 200 {"status":"ok"}
   └── failure → !alertSent && sendAlert(errorMessage)
                             alertSent = true
                → respond 503 {"status":"error","message": errorMessage}
```

### `checkTelegramApi()` — Implementation

Использует глобальный `fetch` (доступен в Node.js 18+) для вызова метода `getMe` с таймаутом 30 секунд:

```javascript
async function checkTelegramApi() {
    const token = process.env.API_KEY_BOT;
    const url = `https://api.telegram.org/bot${token}/getMe`;
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) {
        throw new Error(`Telegram getMe вернул HTTP ${res.status}`);
    }
    const data = await res.json();
    if (!data.ok) {
        throw new Error(`Telegram getMe: ok=false, ${JSON.stringify(data)}`);
    }
}
```

Бросает ошибку при любом сбое (сетевая ошибка, таймаут, non-ok статус, `ok: false` в теле).

### `sendAlert(message)` — Implementation

Использует `node:https` напрямую (без npm-пакетов):

```javascript
function sendAlert(message) {
    const token = process.env.ALERT_BOT_TOKEN;
    const chatId = process.env.ALERT_CHAT_ID;

    if (!token || !chatId) {
        console.warn('[healthcheck] ALERT_BOT_TOKEN или ALERT_CHAT_ID не заданы — алерт пропущен');
        return;
    }

    const body = JSON.stringify({
        chat_id: chatId,
        text: `[Zvuchi Bot] Сбой при healthcheck: ${message}`
    });

    const options = {
        hostname: 'api.telegram.org',
        path: `/bot${token}/sendMessage`,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body)
        }
    };

    const req = https.request(options, (res) => {
        if (res.statusCode !== 200) {
            console.error(`[healthcheck] Ошибка отправки алерта: HTTP ${res.statusCode}`);
        }
    });

    req.on('error', (e) => console.error('[healthcheck] Ошибка HTTPS при отправке алерта:', e.message));
    req.write(body);
    req.end();
}
```

### Response Format

Все ответы `/healthcheck` содержат заголовок `Content-Type: application/json`.

| Сценарий | Статус | Тело |
|----------|--------|------|
| `getMe` успешен | `200` | `{"status":"ok"}` |
| `getMe` упал | `503` | `{"status":"error","message":"<описание ошибки>"}` |
| Любой другой путь | `404` | _(пустое тело)_ |

---

## Integration in `index.js`

```javascript
const { startHealthcheckServer } = require('./src/healthcheck');

// ...существующий код бота...

startHealthcheckServer();
console.log('Healthcheck сервер запущен');
```

Сервер запускается в том же Node.js-процессе, не блокируя event loop бота.

---

## Environment Variables

| Переменная | Обязательна | Назначение |
|------------|-------------|------------|
| `API_KEY_BOT` | Да | Токен основного бота для вызова `getMe` |
| `HEALTHCHECK_PORT` | Нет (default: 3000) | Порт HTTP-сервера |
| `ALERT_BOT_TOKEN` | Нет* | Токен Alert Bot |
| `ALERT_CHAT_ID` | Нет* | Chat ID получателя алертов |

\* Если отсутствуют — алерты пропускаются с предупреждением в лог; сервер продолжает работу.

---

## Error Handling

| Ситуация | Поведение |
|----------|-----------|
| `getMe` → сетевая ошибка / таймаут | `503` + сообщение об ошибке, алерт отправляется однократно |
| `getMe` → HTTP 4xx/5xx | `503` + `"Telegram getMe вернул HTTP N"` |
| `getMe` → `ok: false` | `503` + тело ответа в сообщении |
| `sendAlert` упал | Ошибка логируется, healthcheck-ответ не затрагивается |
| `ALERT_BOT_TOKEN`/`ALERT_CHAT_ID` отсутствуют | Предупреждение в лог, алерт пропускается, сервер работает |
| Неизвестный путь | `404` без тела |

---

## Data Flow Diagram

```
External Monitor
      │
      │ GET /healthcheck
      ▼
  HTTP Server (node:http)
      │
      ├─ path !== /healthcheck ──→ 404
      │
      ▼
  checkTelegramApi()
      │
      ├─ success ──→ alertSent=true?  →  alertSent=false
      │              respond 200 {"status":"ok"}
      │
      └─ failure ──→ alertSent=false? →  sendAlert(msg)
                                         alertSent=true
                     respond 503 {"status":"error","message":...}
```

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Non-healthcheck paths return 404

*For any* HTTP request path that is not exactly `/healthcheck`, the server SHALL respond with HTTP status `404`.

**Validates: Requirements 1.3**

---

### Property 2: Successful probe response invariant

*For any* successful `getMe` response (regardless of the specific response body), the `/healthcheck` endpoint SHALL respond with HTTP status `200`, a `Content-Type: application/json` header, and a body of exactly `{"status":"ok"}`.

**Validates: Requirements 2.2, 2.4**

---

### Property 3: Failed probe response invariant

*For any* error thrown or non-ok response returned by `getMe` (regardless of the specific error message or type), the `/healthcheck` endpoint SHALL respond with HTTP status `503`, a `Content-Type: application/json` header, and a JSON body containing `{"status":"error","message":"<error description>"}` where the message is a non-empty string.

**Validates: Requirements 2.3, 2.4**

---

### Property 4: Alert deduplication

*For any* sequence of consecutive failing healthcheck probes, the Alert Bot SHALL send exactly one alert message — on the first failure — and SHALL NOT send repeated alerts for subsequent failures until a successful probe resets the Alert State.

**Validates: Requirements 3.1, 3.2, 3.3**

---

### Property 5: Alert State recovery round-trip

*For any* healthcheck probe sequence where at least one failure has occurred (Alert State = `true`) followed by a successful probe, the Alert State SHALL be reset to `false`, and no alert message SHALL be sent during the successful probe.

**Validates: Requirements 4.1, 4.2, 4.3**
