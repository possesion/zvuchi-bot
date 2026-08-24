# Implementation Plan

- [x] 1. Написать exploration-тест баг-условия
  - **Property 1: Bug Condition** - Сброс notify при повторном savePhone
  - **CRITICAL**: Этот тест ДОЛЖЕН УПАСТЬ на неисправленном коде — падение подтверждает существование бага
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: Тест кодирует ожидаемое поведение — после исправления он должен пройти
  - **GOAL**: Воспроизвести баг и задокументировать контрпример
  - **Scoped PBT Approach**: Область ограничена конкретным сценарием: существующий пользователь с notify=1 вызывает savePhone повторно
  - Настроить in-memory SQLite (`:memory:`) для изоляции тестов от `bot.db`
  - Создать запись: `INSERT INTO users (user_id, phone_number, notify) VALUES (userId, phone, 1)`
  - Вызвать `savePhone(userId, newPhone)` с тем же `userId`
  - Проверить: `getNotify(userId)` должен вернуть `true` (1)
  - Запустить на НЕИСПРАВЛЕННОМ коде → тест должен УПАСТЬ (`notify` окажется `0`)
  - Задокументировать контрпример: "savePhone(1, '79001234567') после notify=1 → notify стал 0"
  - Отметить задачу выполненной после того, как тест написан, запущен и падение задокументировано
  - _Requirements: 1.1, 1.2_

- [x] 2. Написать preservation-тесты (ДО реализации исправления)
  - **Property 2: Preservation** - Поведение savePhone для новых пользователей и прочих notify-операций
  - **IMPORTANT**: Следовать observation-first методологии
  - Наблюдение на неисправленном коде:
    - Первый `savePhone` для нового `userId` создаёт запись с `notify = 0` → поведение корректное
    - `setNotify(userId, true)` → `getNotify(userId)` возвращает `true` → корректно
    - `setNotify(userId, false)` → `getNotify(userId)` возвращает `false` → корректно
    - `getSubscribedUsers()` возвращает только пользователей с `notify = 1` → корректно
  - Написать property-based тесты по наблюдениям:
    - Для всех новых `userId`: `savePhone` создаёт запись с `notify = 0`
    - Для всех `userId` с `notify = 0`: повторный `savePhone` оставляет `notify = 0` (не ломает)
    - `setNotify(userId, true/false)` + `getNotify` всегда согласованы
    - `getSubscribedUsers` возвращает ровно тех, у кого `notify = 1`
  - Использовать in-memory SQLite для изоляции
  - Запустить на НЕИСПРАВЛЕННОМ коде → тесты должны ПРОЙТИ (фиксируем базовое поведение)
  - Отметить задачу выполненной после прохождения всех preservation-тестов на неисправленном коде
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 3. Исправление: сохранение notify при обновлении номера телефона

  - [x] 3.1 Реализовать исправление в src/database.js
    - Открыть `src/database.js`, найти функцию `savePhone`
    - Заменить SQL-запрос с `INSERT OR REPLACE INTO users (user_id, phone_number) VALUES (?, ?)` на `INSERT INTO users (user_id, phone_number) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET phone_number = excluded.phone_number`
    - `ON CONFLICT(user_id)` срабатывает при конфликте первичного ключа
    - `DO UPDATE SET phone_number = excluded.phone_number` обновляет только `phone_number`
    - Колонки `notify` и `created_at` остаются нетронутыми
    - _Bug_Condition: isBugCondition(userId, phone) → existingUser IS NOT NULL AND existingUser.notify = 1_
    - _Expected_Behavior: phone_number обновляется, notify сохраняется без изменений_
    - _Preservation: новые пользователи получают notify=0; setNotify/getNotify/getSubscribedUsers не затрагиваются_
    - _Requirements: 2.1, 2.2, 3.1, 3.2, 3.3, 3.4_

  - [x] 3.2 Убедиться, что exploration-тест теперь проходит
    - **Property 1: Expected Behavior** - Сохранение notify при повторном savePhone
    - **IMPORTANT**: Перезапустить тот же тест из задачи 1 — НЕ писать новый тест
    - Тест из задачи 1 кодирует ожидаемое поведение
    - Запустить exploration-тест из шага 1
    - **EXPECTED OUTCOME**: Тест ПРОХОДИТ (подтверждает, что баг исправлен)
    - _Requirements: 2.1, 2.2_

  - [x] 3.3 Убедиться, что preservation-тесты по-прежнему проходят
    - **Property 2: Preservation** - Поведение для небагованных входных данных
    - **IMPORTANT**: Перезапустить те же тесты из задачи 2 — НЕ писать новые тесты
    - Запустить все preservation property-тесты из шага 2
    - **EXPECTED OUTCOME**: Тесты ПРОХОДЯТ (регрессий нет)
    - Убедиться, что все тесты прошли после исправления

- [x] 4. Checkpoint — все тесты проходят
  - Запустить полный набор тестов
  - Убедиться, что exploration-тест (Property 1) проходит — баг исправлен
  - Убедиться, что preservation-тесты (Property 2) проходят — регрессий нет
  - Если возникают вопросы, спросить у пользователя
