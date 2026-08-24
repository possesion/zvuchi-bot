# Scheduled Notifications Bugfix Design

## Overview

Текущая реализация `checkAndSendNotifications` запускается cron'ом в 00:00 МСК и в тот же момент проверяет, приходится ли ближайший урок ровно на «завтра» по календарному дню. Такой однофазный подход ненадёжен: уведомление не отправляется, если урок не попадает точно на следующие сутки относительно момента запроса. Кроме того, состояние нигде не сохраняется, поэтому при перезапуске бота уведомления необратимо теряются.

Исправление переводит систему на **двухфазную архитектуру**:

1. **Фаза синхронизации** (`syncSchedule`) — запрашивает CRM, вычисляет `scheduled_at = next_lesson_date − 24 ч`, сохраняет в БД и сразу ставит `setTimeout` на точный момент отправки.
2. **Восстановление при старте** (`restoreSchedules`) — при запуске бота читает все несработавшие записи из БД и восстанавливает таймеры; просроченные записи (`delay <= 0`) пропускаются автоматически.

Поминутного cron-поллинга нет — доставка реализована через `setTimeout`.

## Glossary

- **Bug_Condition (C)**: Условие, при котором баг проявляется — `shouldSendNotification` возвращает `false` для урока, до которого менее 24 часов, но он не попадает точно на завтрашний календарный день; либо бот перезапускается и теряет единственный шанс отправить уведомление.
- **Property (P)**: Ожидаемое поведение при наступлении условия — уведомление отправляется через `setTimeout`, сработавший ровно в `scheduledAt`, независимо от дня недели и перезапусков.
- **Preservation**: Поведение, которое не должно измениться после исправления — все команды (`/start`, `/lessonstotal`, `/nextlesson`, `/notify`, `/unsubscribe`), кэш CRM и кэш токена.
- **syncSchedule**: Функция в `src/notifications.js`, которая синхронизирует расписание из CRM в БД и ставит `setTimeout`.
- **scheduleNotification**: Функция в `src/notifications.js`, которая принимает `userId`, `nextLessonDate`, `scheduledAt`, `botStartTime`, вычисляет `delay = scheduledAt - Date.now()` и при `delay > 0` ставит `setTimeout`.
- **restoreSchedules**: Функция в `src/notifications.js`, вызываемая при старте бота; читает `getPendingSchedules()` и вызывает `scheduleNotification` для каждой записи.
- **scheduled_at**: Unix timestamp в мс, хранящийся в колонке `users.scheduled_at` — момент, когда нужно отправить уведомление (`lessonDate − 24 ч`).
- **botStartTime**: `Date.now()` в момент запуска `index.js`; передаётся в `scheduleNotification` как ориентир — просроченные записи (`scheduledAt < Date.now()` в момент вызова) пропускаются.
- **getPendingSchedules**: Новая функция в `src/database.js` — `SELECT user_id, next_lesson_date, scheduled_at FROM users WHERE scheduled_at IS NOT NULL AND sent = 0 AND notify = 1`.

## Bug Details

### Bug Condition

Баг проявляется в двух сценариях:

**Сценарий A** — `shouldSendNotification` использует сравнение по календарному дню («завтра»), а не по интервалу времени. Если урок назначен через 20 часов, но уже перешагнул полночь (т.е. сегодня воскресенье, урок в воскресенье в 10:00, cron запустился в 00:00 воскресенья) — `tomorrow` указывает на понедельник, сравнение проваливается, уведомление не отправляется.

**Сценарий B** — состояние не сохраняется. При перезапуске бота между 00:00 и временем урока cron уже не запустится повторно, и уведомление теряется.

**Formal Specification:**
```
FUNCTION isBugCondition(user, now)
  INPUT: user из таблицы users (с notify=1 и phone_number), now = Date.now()
  OUTPUT: boolean

  lessonDate = parseLessonDate(getClientData(user.phone_number).next_lesson_date)
  hoursUntilLesson = (lessonDate.getTime() - now) / 3600000

  -- Сценарий A: урок менее чем через 24 ч, но shouldSendNotification вернёт false
  SCENARIO_A = hoursUntilLesson > 0
               AND hoursUntilLesson < 24
               AND NOT isTomorrow(lessonDate, now)

  -- Сценарий B: бот перезапустился, scheduled_at не сохранён
  SCENARIO_B = hoursUntilLesson > 0
               AND hoursUntilLesson < 24
               AND botWasRestartedAfterMidnight(now)

  RETURN SCENARIO_A OR SCENARIO_B
END FUNCTION
```

### Examples

- **Сценарий A — воскресный урок**: Урок в воскресенье в 10:00, cron запускается в 00:00 воскресенья. `tomorrow` — понедельник. `shouldSendNotification` возвращает `false`. Уведомление не отправляется, хотя до урока 10 часов.
- **Сценарий A — пятничный урок**: Урок в пятницу в 23:30, cron запускается в 00:00 пятницы. `tomorrow` — суббота. Уведомление не отправляется, хотя до урока 23.5 часа.
- **Сценарий B — рестарт**: Cron сработал в 00:00, CRM вернул ошибку, уведомление не было запланировано. Бот перезапустился в 09:00. Следующий cron только в 00:00 следующих суток. Уведомление потеряно.
- **Сценарий B — деплой**: Новая версия деплоится в 08:00. Урок в 10:00. После рестарта `restoreSchedules` найдёт запись в БД: `scheduledAt = урок − 24ч`. Если `scheduledAt < Date.now()` — таймер не ставится, уведомление пропускается (правило рестарта). Если `scheduledAt > Date.now()` — таймер восстанавливается.
- **Корректный случай (нет бага)**: Урок во вторник в 14:00, cron запускается в 00:00 понедельника. `syncSchedule` записывает `scheduled_at = вторник 14:00 − 24ч = понедельник 14:00`, ставит `setTimeout` на 14 часов. В 14:00 таймер срабатывает, уведомление отправляется.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Команда `/start` должна по-прежнему отвечать приветственным сообщением.
- Команда `/lessonstotal` должна по-прежнему возвращать остаток оплаченных уроков из CRM.
- Команда `/nextlesson` должна по-прежнему возвращать дату следующего урока из CRM.
- Команда `/notify` без сохранённого номера телефона должна по-прежнему запрашивать номер.
- Команда `/unsubscribe` должна по-прежнему отключать уведомления и подтверждать это.
- `getClientData` с тем же номером в течение 60 с должна по-прежнему возвращать кэшированные данные.
- Auth-токен, полученный менее 3500 с назад, должен по-прежнему использоваться без повторной аутентификации.
- `savePhone` должна по-прежнему сохранять только цифры из номера.
- Контакт должен сохраняться только если принадлежит отправившему пользователю.

**Scope:**
Все пути кода, не связанные с логикой планирования уведомлений (`syncSchedule`, `scheduleNotification`, `restoreSchedules`, `setSchedule`, `clearSchedule`, `markSent`), должны остаться полностью неизменными.

## Hypothesized Root Cause

На основе анализа кода наиболее вероятны следующие причины:

1. **Сравнение по календарному дню вместо временного интервала**: `shouldSendNotification` сравнивает `lessonDate` с `tomorrow` (завтрашний календарный день). Это не эквивалентно «менее 24 часов до урока». Для урока в воскресенье, запущенного cron'ом в воскресенье в 00:00, `tomorrow` — понедельник, сравнение всегда ложно.

2. **Отсутствие персистентного состояния**: Текущая реализация нигде не записывает факт «уведомление запланировано». Всё хранится только в памяти процесса. При перезапуске вся история теряется, и cron запускается только раз в сутки.

3. **Однофазная архитектура**: Принятие решения об отправке и сама отправка происходят в одной функции в один момент времени. Нет возможности «запомнить» намерение отправить уведомление и реализовать его позже.

4. **Отправка ошибок CRM пользователям**: При сбое API в `checkAndSendNotifications` пользователю отправляется сообщение `'Не могу получить данные об уроке в CRM'`. Это не ожидаемое поведение — ошибка синхронизации не должна беспокоить пользователя.

## Correctness Properties

Property 1: Bug Condition — Точная доставка через setTimeout

_For any_ пользователя с `notify = 1`, у которого `syncSchedule` записал `scheduled_at` в БД, система SHALL поставить `setTimeout` на `scheduledAt - Date.now()` и отправить уведомление при его срабатывании.

**Validates: Requirements 2.1, 2.5**

Property 2: Bug Condition — Пропуск просроченных при рестарте

_For any_ записи с `scheduled_at < Date.now()` в момент вызова `scheduleNotification`, функция SHALL вернуться без постановки таймера и без отправки сообщения.

**Validates: Requirements 2.2**

Property 3: Preservation — Идемпотентность syncSchedule

_For any_ пользователя с `existing.next_lesson_date === clientData.next_lesson_date AND existing.sent === 1`, `syncSchedule` SHALL не изменять запись и не ставить новый таймер.

**Validates: Requirements 2.6**

Property 4: Preservation — Защита от двойной отправки

_For any_ таймера, сработавшего после обновления `scheduled_at` (т.е. `record.scheduled_at !== scheduledAt`), `scheduleNotification` SHALL не отправлять сообщение.

**Validates: Requirements 2.8**

Property 5: Preservation — Неизменность команд и кэшей

_For any_ входящего сообщения, не связанного с логикой `syncSchedule`/`scheduleNotification`/`restoreSchedules` (команды `/start`, `/lessonstotal`, `/nextlesson`, `/notify`, `/unsubscribe`, запросы CRM, управление токеном), фиксированный код SHALL производить в точности то же поведение, что и оригинальный.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9**

## Fix Implementation

### Changes Required

**File**: `src/database.js`

**Changes**:
1. **Три новые колонки через миграции** (по аналогии с `initializeNotifyColumn`):
   - `next_lesson_date TEXT DEFAULT NULL`
   - `scheduled_at INTEGER DEFAULT NULL`
   - `sent BOOLEAN DEFAULT 0`
2. **`setSchedule(userId, nextLessonDate, scheduledAt)`** — `UPDATE users SET next_lesson_date=?, scheduled_at=?, sent=0 WHERE user_id=?`
3. **`clearSchedule(userId)`** — `UPDATE users SET next_lesson_date=NULL, scheduled_at=NULL, sent=0 WHERE user_id=?`
4. **`getSchedule(userId)`** — `SELECT next_lesson_date, scheduled_at, sent FROM users WHERE user_id=?`, возвращает объект или `null`
5. **`getPendingSchedules()`** — `SELECT user_id, next_lesson_date, scheduled_at FROM users WHERE scheduled_at IS NOT NULL AND sent = 0 AND notify = 1`
6. **`markSent(userId)`** — `UPDATE users SET sent=1 WHERE user_id=?`

> `getDueNotifications(now, botStartTime)` **не нужна** — поллинга нет.

---

**File**: `src/notifications.js`

**Changes**:
1. **Удалить**: `shouldSendNotification`, `checkAndSendNotifications`, `runDailyCheck`, `sendDueNotifications`
2. **Оставить без изменений**: `parseLessonDate`, `extractTime`, `formatNotificationMessage`, `getClientDataWithRetry`
3. **Добавить `scheduleNotification(bot, userId, nextLessonDate, scheduledAt, botStartTime)`**:
   ```js
   function scheduleNotification(bot, userId, nextLessonDate, scheduledAt, botStartTime) {
     const delay = scheduledAt - Date.now();
     if (delay <= 0) return; // просрочено — пропустить
     setTimeout(async () => {
       try {
         const record = getSchedule(userId);
         if (!record || record.scheduled_at !== scheduledAt || record.sent) return;
         await bot.sendMessage(userId, formatNotificationMessage({ next_lesson_date: nextLessonDate }));
         markSent(userId);
       } catch (e) {
         console.error(`Ошибка отправки уведомления для ${userId}:`, e);
       }
     }, delay);
   }
   ```
4. **Добавить `restoreSchedules(bot, botStartTime)`**:
   - `getPendingSchedules()` — все несработавшие записи
   - Для каждой вызвать `scheduleNotification(bot, row.user_id, row.next_lesson_date, row.scheduled_at, botStartTime)`
   - Просроченные автоматически пропускаются внутри `scheduleNotification`
5. **Обновить `syncSchedule(bot, userIds = null, botStartTime)`**:
   - Если `userIds === null` — `getSubscribedUsers()`; иначе использовать переданный список
   - Для каждого: получить телефон → `getClientDataWithRetry` → при ошибке `console.error` + `continue` (без `bot.sendMessage`)
   - Если нет `next_lesson_date` → `clearSchedule(userId)`
   - Если `existing.next_lesson_date === clientData.next_lesson_date && existing.sent === 1` → `continue`
   - Иначе → `setSchedule(userId, next_lesson_date, scheduledAt)` → `scheduleNotification(bot, userId, next_lesson_date, scheduledAt, botStartTime)`
6. **Экспортировать**: `syncSchedule`, `restoreSchedules`, `scheduleNotification`, `parseLessonDate`, `extractTime`, `formatNotificationMessage`, `getClientDataWithRetry`

---

**File**: `src/handlers.js`

**Changes**:
1. Обновить сигнатуру фабрики: `handleText(bot, botStartTime)`
2. Добавить импорт `syncSchedule` из `./notifications`
3. В блоке `/notify`, после `setNotify(userId, true)`:
   ```js
   syncSchedule(bot, [userId], botStartTime).catch(e => console.error('Ошибка syncSchedule при /notify:', e));
   ```

---

**File**: `index.js`

**Changes**:
1. Добавить `const botStartTime = Date.now();` в самом начале
2. Заменить импорт `runDailyCheck` на `{ syncSchedule, restoreSchedules }` из `./src/notifications`
3. Вызвать `restoreSchedules(bot, botStartTime)` сразу после создания бота
4. Оставить только один cron: `'0 0 * * *'` → `syncSchedule(bot, null, botStartTime)` с `{ timezone: 'Europe/Moscow' }`
5. Убрать cron `'* * * * *'` (его не существует в исходнике, но в плане он был — подтвердить отсутствие)

## Testing Strategy

### Validation Approach

Стратегия тестирования следует двухфазному подходу: сначала воспроизвести баги на **нефиксированном** коде, чтобы подтвердить гипотезу о корневых причинах, затем верифицировать исправление и отсутствие регрессий.

### Exploratory Bug Condition Checking

**Goal**: Показать контрпримеры на нефиксированном коде. Подтвердить или опровергнуть анализ корневых причин.

**Test Cases**:
1. **Воскресный cron**: `shouldSendNotification` с `lessonDate` = сегодня → ожидаем `false` (баг: должно быть `true` при hoursUntilLesson < 24)
2. **Пятничный вечерний урок**: аналогично — `shouldSendNotification` возвращает `false`
3. **Отсутствие персистентности**: Колонки `scheduled_at`, `sent`, `next_lesson_date` не существуют в БД — любой запрос к ним упадёт
4. **Ошибка CRM → сообщение пользователю**: `checkAndSendNotifications` при rejection CRM отправляет `'Не могу получить данные об уроке в CRM'` (нежелательное поведение)

**Expected Counterexamples**:
- `shouldSendNotification` возвращает `false` для уроков в текущий день
- Схема БД не содержит колонок персистентного расписания
- При ошибке CRM пользователь получает нежелательное сообщение

### Fix Checking

**Goal**: Убедиться, что для всех входов, где выполняется bug condition, исправленные функции производят ожидаемое поведение.

**Test Cases**:
1. **Точная доставка**: `syncSchedule` записывает `scheduled_at`, `scheduleNotification` ставит таймер; при срабатывании — `bot.sendMessage` вызван
2. **Пропуск просроченных**: `scheduleNotification` с `delay <= 0` — таймер не ставится, `bot.sendMessage` не вызван
3. **Восстановление при старте**: `restoreSchedules` находит несработавшие записи и восстанавливает таймеры
4. **Защита от двойной отправки**: таймер сработал после изменения `scheduled_at` → `bot.sendMessage` не вызван
5. **Ошибка CRM в syncSchedule**: `bot.sendMessage` не вызван, только `console.error`

### Preservation Checking

**Test Cases**:
1. `parseLessonDate` корректно парсит граничные случаи (конец месяца, конец года, 23:59)
2. `formatNotificationMessage` формирует корректный текст с именем и без
3. `getClientDataWithRetry` при ошибке на первой попытке делает повторный запрос через 1 с

### Unit Tests

- `scheduleNotification` с `delay <= 0` — `setTimeout` не вызван
- `scheduleNotification` с `delay > 0` — `setTimeout` вызван с корректным delay
- `scheduleNotification` при срабатывании таймера — `bot.sendMessage` вызван, `markSent` вызван
- `scheduleNotification` при изменившемся `scheduled_at` (record.scheduled_at !== scheduledAt) — `bot.sendMessage` не вызван
- `scheduleNotification` при `record.sent === 1` — `bot.sendMessage` не вызван
- `restoreSchedules` вызывает `scheduleNotification` для каждой записи из `getPendingSchedules()`
- `syncSchedule` при ошибке CRM — не вызывает `bot.sendMessage`, не вызывает `scheduleNotification`
- `syncSchedule` при `sent=1` и неизменной дате — не вызывает `setSchedule`, не вызывает `scheduleNotification`
- `syncSchedule` при изменившейся дате — вызывает `setSchedule` и `scheduleNotification`
- `syncSchedule` при отсутствии `next_lesson_date` — вызывает `clearSchedule`
- `getDueNotifications` — функция удалена, тест не нужен

### Property-Based Tests

- Для любого корректного `next_lesson_date` из CRM: `scheduled_at = parseLessonDate(next_lesson_date).getTime() - 86400000`
- Для любого `delay <= 0`: `scheduleNotification` не ставит таймер
- Для любого `delay > 0`: `scheduleNotification` ставит таймер с корректным delay
- Для любой последовательности вызовов `syncSchedule` с одной и той же датой и `sent=1`: БД не изменяется (идемпотентность)

### Integration Tests

- Полный цикл: `/notify` → `syncSchedule` → таймер сработал → уведомление отправлено
- Рестарт: `syncSchedule` записывает в БД → эмуляция рестарта → `restoreSchedules` с `scheduledAt < Date.now()` — таймер не ставится
- Рестарт с будущей датой: `restoreSchedules` с `scheduledAt > Date.now()` — таймер восстановлен
- Обновление расписания: `syncSchedule` с датой A → `syncSchedule` с датой B → старый таймер не отправляет (защита: `record.scheduled_at !== scheduledAtA`)
