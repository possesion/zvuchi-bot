# Implementation Plan

- [ ] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - Однофазная доставка уведомлений и отсутствие персистентности
  - **IMPORTANT**: Write this property-based test BEFORE implementing the fix
  - **CRITICAL**: This test MUST FAIL on unfixed code — failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **GOAL**: Surface counterexamples that demonstrate the bugs exist
  - Test 1 (Сценарий A): Вызвать `shouldSendNotification(lessonDate)` где `lessonDate` — сегодняшний день (не завтра), до урока < 24 ч. Ожидаем `true`, нефиксированный код возвращает `false` → баг подтверждён
    - Пример: `now` = воскресенье 00:00, `lessonDate` = воскресенье 10:00 — `shouldSendNotification` должна вернуть `true`, возвращает `false`
    - Пример: `now` = пятница 00:00, `lessonDate` = пятница 23:30 — аналогично
  - Test 2 (Сценарий B): Убедиться, что в `database.js` нет колонок `scheduled_at` / `sent` / `next_lesson_date` — любой запрос к этим колонкам упадёт. Подтверждает отсутствие персистентного состояния
  - Test 3 (CRM-ошибка): Замокать `getClientDataWithRetry` с rejection, вызвать `checkAndSendNotifications`. Ожидаем, что `bot.sendMessage` НЕ вызван. Нефиксированный код вызовет `bot.sendMessage('Не могу получить данные об уроке в CRM')` → баг подтверждён
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests FAIL (this is correct — it proves the bugs exist)
  - Document counterexamples found to understand root cause
  - Mark task complete when tests are written, run, and failures are documented
  - _Requirements: 1.1, 1.2, 1.3_

- [ ] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 5: Preservation** - Вспомогательные функции notifications.js
  - **IMPORTANT**: Follow observation-first methodology
  - Observe behavior on UNFIXED code for non-buggy inputs
  - Observe: `parseLessonDate('15.07.2025 10:30')` → `new Date(2025, 6, 15, 10, 30)` на нефиксированном коде
  - Observe: `parseLessonDate('31.12.2025 23:59')` → `new Date(2025, 11, 31, 23, 59)` (граничный случай конец года)
  - Observe: `parseLessonDate('28.02.2025 09:00')` → `new Date(2025, 1, 28, 9, 0)` (конец февраля)
  - Observe: `formatNotificationMessage({ next_lesson_date: '15.07.2025 10:30', name: 'Иван' })` → `'Привет, Иван, завтра в 10:30 у тебя урок по вокалу.'`
  - Observe: `formatNotificationMessage({ next_lesson_date: '15.07.2025 10:30' })` → `'Привет, студент, завтра в 10:30 у тебя урок по вокалу.'` (имя по умолчанию)
  - Observe: `getClientDataWithRetry(phone)` при ошибке на первой попытке — делает повторный запрос через 1 с
  - Write property-based tests asserting these observed behaviors across the input domain
  - Verify tests pass on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9_

- [ ] 3. Fix: Двухфазная архитектура уведомлений

  - [ ] 3.1 Добавить колонки и функции в `src/database.js`
    - Добавить три миграции по аналогии с `initializeNotifyColumn`: `next_lesson_date TEXT DEFAULT NULL`, `scheduled_at INTEGER DEFAULT NULL`, `sent BOOLEAN DEFAULT 0`
    - Добавить `setSchedule(userId, nextLessonDate, scheduledAt)` — `UPDATE users SET next_lesson_date=?, scheduled_at=?, sent=0 WHERE user_id=?`
    - Добавить `clearSchedule(userId)` — `UPDATE users SET next_lesson_date=NULL, scheduled_at=NULL, sent=0 WHERE user_id=?`
    - Добавить `getSchedule(userId)` — `SELECT next_lesson_date, scheduled_at, sent FROM users WHERE user_id=?`, возвращает объект или `null`
    - Добавить `getPendingSchedules()` — `SELECT user_id, next_lesson_date, scheduled_at FROM users WHERE scheduled_at IS NOT NULL AND sent = 0 AND notify = 1`
    - Добавить `markSent(userId)` — `UPDATE users SET sent=1 WHERE user_id=?`
    - Экспортировать все новые функции
    - **Не добавлять** `getDueNotifications` — поллинга нет
    - _Requirements: 2.1, 2.5, 2.6, 2.7, 2.9_

  - [ ] 3.2 Переписать `src/notifications.js`
    - Добавить импорты: `setSchedule`, `clearSchedule`, `getSchedule`, `getPendingSchedules`, `markSent` из `./database`
    - Удалить функции: `shouldSendNotification`, `checkAndSendNotifications`, `runDailyCheck`
    - Оставить без изменений: `parseLessonDate`, `extractTime`, `formatNotificationMessage`, `getClientDataWithRetry`
    - Добавить `scheduleNotification(bot, userId, nextLessonDate, scheduledAt, botStartTime)`:
      ```js
      function scheduleNotification(bot, userId, nextLessonDate, scheduledAt, botStartTime) {
        const delay = scheduledAt - Date.now();
        if (delay <= 0) return;
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
    - Добавить `restoreSchedules(bot, botStartTime)`:
      - `getPendingSchedules()` → для каждой записи вызвать `scheduleNotification(bot, row.user_id, row.next_lesson_date, row.scheduled_at, botStartTime)`
    - Добавить `syncSchedule(bot, userIds = null, botStartTime)`:
      - Если `userIds === null` — `getSubscribedUsers()`; иначе использовать переданный список
      - Для каждого пользователя: получить телефон → `getClientDataWithRetry` → при ошибке `console.error` + `continue` (НЕ `bot.sendMessage`)
      - Если нет `next_lesson_date` → `clearSchedule(userId)`
      - Если `existing.next_lesson_date === clientData.next_lesson_date && existing.sent === 1` → `continue`
      - Иначе → `setSchedule(userId, next_lesson_date, scheduledAt)` → `scheduleNotification(bot, userId, next_lesson_date, scheduledAt, botStartTime)`
    - Экспортировать: `syncSchedule`, `restoreSchedules`, `scheduleNotification`, `parseLessonDate`, `extractTime`, `formatNotificationMessage`, `getClientDataWithRetry`
    - _Requirements: 2.1, 2.2, 2.3, 2.5, 2.6, 2.7, 2.8, 2.9_

  - [ ] 3.3 Обновить `src/handlers.js`
    - Обновить сигнатуру фабрики: `handleText(bot, botStartTime)`
    - Добавить импорт `syncSchedule` из `./notifications`
    - В блоке `/notify`, после `setNotify(userId, true)`, добавить fire-and-forget:
      ```js
      syncSchedule(bot, [userId], botStartTime).catch(e => console.error('Ошибка syncSchedule при /notify:', e));
      ```
    - Никакие другие изменения в handlers.js не вносить
    - _Requirements: 2.4_

  - [ ] 3.4 Обновить `index.js`
    - Добавить `const botStartTime = Date.now();` в начало файла (до создания бота)
    - Заменить импорт `runDailyCheck` на `{ syncSchedule, restoreSchedules }` из `./src/notifications`
    - Вызвать `restoreSchedules(bot, botStartTime)` сразу после создания бота (до регистрации обработчиков событий или сразу после)
    - Обновить регистрацию обработчика text: `bot.on('text', handleText(bot, botStartTime))`
    - Заменить cron-задачу `runDailyCheck` на одну:
      - `'0 0 * * *'` → `syncSchedule(bot, null, botStartTime)` с `{ timezone: 'Europe/Moscow' }` (ежедневно в 00:00 МСК)
    - **Убрать** cron `'* * * * *'` — поллинга нет
    - _Requirements: 2.1, 2.2, 2.9_

- [ ] 4. Verify bug condition exploration test now passes
  - **Property 1: Expected Behavior** - Двухфазная доставка уведомлений
  - **IMPORTANT**: Re-run the SAME tests from task 1 — do NOT write new tests
  - Test 1: `shouldSendNotification` удалена; `syncSchedule` + `scheduleNotification` корректно обрабатывают урок в текущий день — `bot.sendMessage` вызван при срабатывании таймера
  - Test 2: Колонки `scheduled_at`, `sent`, `next_lesson_date` существуют в БД — персистентность обеспечена
  - Test 3: `syncSchedule` при ошибке CRM — `bot.sendMessage` НЕ вызван, только `console.error`
  - Run bug condition exploration tests from step 1 on FIXED code
  - **EXPECTED OUTCOME**: Tests PASS (confirms bugs are fixed)
  - _Requirements: 2.1, 2.2, 2.3, 2.4 — Expected Behavior Properties from design_

  - [ ] 4.1 Verify preservation tests still pass
    - **Property 5: Preservation** - Вспомогательные функции notifications.js
    - **IMPORTANT**: Re-run the SAME tests from task 2 — do NOT write new tests
    - Run preservation property tests from step 2 on FIXED code
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - Confirm `parseLessonDate`, `formatNotificationMessage`, `getClientDataWithRetry` behave identically

- [ ] 5. Checkpoint — Ensure all tests pass
  - Запустить полный прогон всех тестов (exploration + preservation)
  - Убедиться, что exploration-тесты из задачи 1 проходят на исправленном коде
  - Убедиться, что preservation-тесты из задачи 2 проходят на исправленном коде
  - Убедиться, что нет новых ошибок в существующей логике бота
  - При возникновении вопросов — спросить пользователя перед продолжением
