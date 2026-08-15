# Implementation Plan: bot-healthcheck-monitoring

## Overview

Создаём модуль `src/healthcheck.js` с HTTP-сервером на базе встроенного `node:http`, подключаем его к `index.js`. Модуль проверяет Telegram API через `getMe`, управляет Alert State в памяти и однократно отправляет алерт через Alert Bot при сбое.

## Tasks

- [ ] 1. Создать модуль `src/healthcheck.js` с базовым HTTP-сервером
  - [ ] 1.1 Реализовать функцию `startHealthcheckServer(port)` и базовую маршрутизацию
    - Создать файл `src/healthcheck.js`
    - Инициализировать in-memory переменную `alertSent = false`
    - Реализовать `startHealthcheckServer(port)`: создаёт `http.Server`, слушает на `port || process.env.HEALTHCHECK_PORT || 3000`
    - Запросы на путь, отличный от `/healthcheck`, возвращают `404` без тела
    - Экспортировать `{ startHealthcheckServer }` через `module.exports`
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [ ]* 1.2 Написать property-тест: не-healthcheck пути возвращают 404
    - **Property 1: Non-healthcheck paths return 404**
    - **Validates: Requirements 1.3**
    - Генерировать произвольные пути (не равные `/healthcheck`), проверять статус ответа `404`

- [ ] 2. Реализовать проверку Telegram API (`checkTelegramApi`)
  - [ ] 2.1 Реализовать функцию `checkTelegramApi()`
    - Использовать глобальный `fetch` с `AbortSignal.timeout(30000)` для вызова `getMe`
    - Бросать ошибку при HTTP-статусе не-ok: `"Telegram getMe вернул HTTP N"`
    - Бросать ошибку при `data.ok === false`: включить тело ответа в сообщение
    - Бросать ошибку при сетевом сбое / таймауте
    - _Requirements: 2.1, 2.2, 2.3_

  - [ ] 2.2 Реализовать `handleHealthcheck(req, res)` и подключить к серверу
    - Вызывать `await checkTelegramApi()`
    - При успехе: если `alertSent === true` → `alertSent = false`; ответ `200`, `Content-Type: application/json`, тело `{"status":"ok"}`
    - При ошибке: если `alertSent === false` → вызвать `sendAlert(message)`, затем `alertSent = true`; ответ `503`, `Content-Type: application/json`, тело `{"status":"error","message":"<описание>"}`
    - Зарегистрировать хендлер в `startHealthcheckServer`
    - _Requirements: 1.2, 2.2, 2.3, 2.4, 3.3, 4.1, 4.2_

  - [ ]* 2.3 Написать property-тест: инвариант успешного ответа (Property 2)
    - **Property 2: Successful probe response invariant**
    - **Validates: Requirements 2.2, 2.4**
    - Мокировать `checkTelegramApi` как успешный (resolve); проверять статус `200`, заголовок `Content-Type: application/json`, тело `{"status":"ok"}`

  - [ ]* 2.4 Написать property-тест: инвариант ответа при сбое (Property 3)
    - **Property 3: Failed probe response invariant**
    - **Validates: Requirements 2.3, 2.4**
    - Мокировать `checkTelegramApi` с произвольными ошибками; проверять статус `503`, заголовок `Content-Type: application/json`, тело `{"status":"error","message":"<непустая строка>"}`

- [ ] 3. Checkpoint — убедиться, что базовый сервер работает корректно
  - Убедиться, что все тесты проходят; при вопросах обратиться к пользователю.

- [ ] 4. Реализовать отправку алертов (`sendAlert`)
  - [ ] 4.1 Реализовать функцию `sendAlert(message)` через `node:https`
    - Импортировать `const https = require('node:https')`
    - Читать `ALERT_BOT_TOKEN` и `ALERT_CHAT_ID` из `process.env`
    - Если один из них отсутствует — логировать предупреждение `console.warn` и выйти без отправки
    - Отправлять POST на `https://api.telegram.org/bot${token}/sendMessage` с телом `{"chat_id":..., "text":"[Zvuchi Bot] Сбой при healthcheck: <message>"}`
    - Устанавливать заголовки `Content-Type: application/json` и `Content-Length`
    - Логировать ошибки HTTP-статуса и сетевые ошибки через `console.error`; не пробрасывать исключения
    - _Requirements: 3.1, 3.2, 3.4, 5.1, 5.2, 5.3_

  - [ ]* 4.2 Написать property-тест: дедупликация алертов (Property 4)
    - **Property 4: Alert deduplication**
    - **Validates: Requirements 3.1, 3.2, 3.3**
    - Мокировать `checkTelegramApi` как падающий N раз подряд; проверять, что `sendAlert` вызван ровно один раз

  - [ ]* 4.3 Написать property-тест: восстановление Alert State (Property 5)
    - **Property 5: Alert State recovery round-trip**
    - **Validates: Requirements 4.1, 4.2, 4.3**
    - Мокировать последовательность: M сбоев, затем K успехов; проверять, что после первого успеха `alertSent === false` и повторный алерт не отправляется

- [ ] 5. Подключить healthcheck-сервер к `index.js`
  - [ ] 5.1 Добавить вызов `startHealthcheckServer()` в `index.js`
    - Добавить `require('./src/healthcheck')` и вызов `startHealthcheckServer()` после инициализации бота
    - Добавить `console.log('Healthcheck сервер запущен')` после запуска
    - Убедиться, что сервер запускается в том же процессе, не блокируя polling
    - _Requirements: 1.4, 6.1, 6.2_

- [ ] 6. Final checkpoint — убедиться, что всё работает корректно
  - Убедиться, что все тесты проходят; при вопросах обратиться к пользователю.

## Notes

- Задачи, помеченные `*`, опциональны и могут быть пропущены для быстрого MVP
- Модуль не импортирует `src/database.js` и не обращается к `bot.db` (Requirements 6.1, 6.2)
- Новые npm-зависимости не требуются — только встроенные `node:http` и `node:https`
- Глобальный `fetch` доступен в Node.js 18+ без импорта
- Property-тесты проверяют универсальные инварианты для любых входных данных, а не только конкретные примеры

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1"] },
    { "id": 2, "tasks": ["2.2"] },
    { "id": 3, "tasks": ["2.3", "2.4", "4.1"] },
    { "id": 4, "tasks": ["4.2", "4.3", "5.1"] }
  ]
}
```
