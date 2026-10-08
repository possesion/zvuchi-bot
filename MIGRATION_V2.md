# Миграция на node-telegram-bot-api v2.1.0

## Статус: ✅ Завершено

Код успешно мигрирован с версии v1 (0.67.0) на версию v2.1.0.

## Основные изменения

### 1. **index.js**
- ✅ Заменён импорт `TelegramBot` на `Bot` из v2
- ✅ Изменена инициализация: `new Bot(token, options)` с настройками retry
- ✅ Добавлены параметры для предотвращения 429 ошибок:
  - `maxRetries: 2`
  - `retryBackoffMs: 1000` (увеличено с 300ms по умолчанию)
- ✅ Заменён `polling: true` на `bot.startPolling()`
- ✅ Централизована обработка ошибок через `bot.catch()`
- ✅ Удалён отдельный обработчик `polling_error`

### 2. **src/handlers.js**
- ✅ Обновлены сигнатуры обработчиков: `(msg) =>` на `async (ctx) =>`
- ✅ Заменены прямые вызовы `bot.sendMessage()` на `bot.api.sendMessage()`
- ✅ Добавлены проверки на существование `ctx.message`, `ctx.from`, `ctx.chat`
- ✅ Адаптирован доступ к данным через контекст v2

### 3. **src/notifications.js**
- ✅ Обновлены вызовы `bot.sendMessage()` на `bot.api.sendMessage({ chat_id, text })`
- ✅ Обновлены JSDoc комментарии с правильным типом `@param {import('node-telegram-bot-api').Bot}`
- ✅ Добавлены задержки между запросами для предотвращения 429:
  - 100ms между отправками уведомлений
  - 200ms между запросами к CRM при синхронизации

### 4. **src/healthcheck.js**
- ✅ Заменён прямой `fetch()` на `bot.api.getMe()`
- ✅ Обновлены сигнатуры функций для передачи `bot` экземпляра
- ✅ Обновлены JSDoc комментарии

## Настройки retry для избежания 429 ошибок

```javascript
const bot = new Bot(process.env.API_KEY_BOT, {
    maxRetries: 2,              // Умеренное количество попыток
    retryBackoffMs: 1000,       // Увеличено с 300ms до 1000ms
});
```

Дополнительные меры:
- Задержка 100ms между отправками уведомлений в цикле
- Задержка 200ms между запросами к CRM при синхронизации
- Встроенный jittered backoff в v2 API

## Ключевые отличия v2 от v1

| Аспект | v1 | v2 |
|--------|----|----|
| Импорт | `require('node-telegram-bot-api')` | `const { Bot } = require('node-telegram-bot-api')` |
| Инициализация | `new TelegramBot(token, { polling: true })` | `new Bot(token); bot.startPolling()` |
| Обработчики | `bot.on('message', msg => ...)` | `bot.on('message', ctx => ...)` |
| Отправка | `bot.sendMessage(chatId, text)` | `bot.api.sendMessage({ chat_id, text })` |
| Ошибки | `bot.on('polling_error', ...)` | `bot.catch((err, ctx) => ...)` |
| Контекст | Прямой доступ к `msg` | Через `ctx.message`, `ctx.from`, `ctx.chat` |

## Обратная совместимость

⚠️ **Внимание:** v2 не имеет обратной совместимости с v1. Это полная переработка API.

## Тестирование

После миграции:
1. ✅ Код компилируется без ошибок
2. ⚠️ Некоторые существующие тесты требуют обновления моков (не связано с миграцией)
3. Требуется ручное тестирование:
   - [ ] Команда `/start`
   - [ ] Команда `/lessonstotal`
   - [ ] Команда `/nextlesson`
   - [ ] Команда `/notify`
   - [ ] Команда `/unsubscribe`
   - [ ] Отправка контакта
   - [ ] Cron-задачи (синхронизация и уведомления)
   - [ ] Healthcheck endpoints

## Документация

- [Официальный README v2](./node_modules/node-telegram-bot-api/README.md)
- [CHANGELOG с гидом миграции](https://github.com/yagop/node-telegram-bot-api/blob/master/CHANGELOG.md)

## Следующие шаги

1. Запустить бота в тестовой среде
2. Проверить все команды вручную
3. Мониторить логи на предмет 429 ошибок
4. При необходимости дополнительно увеличить `retryBackoffMs` или добавить `rateLimit`
5. Обновить моки в тестах для совместимости с v2 API

## Рекомендации

Если бот будет получать 429 ошибки при высокой нагрузке, добавьте глобальный rate limit:

```javascript
const bot = new Bot(token, {
    maxRetries: 2,
    retryBackoffMs: 1000,
    rateLimit: { 
        global: 25,      // 25 запросов в секунду глобально
        perChat: 1       // 1 запрос в секунду на один чат
    }
});
```
