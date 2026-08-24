# notify-reset-on-phone-save-fix Bugfix Design

## Overview

Функция `savePhone` в `src/database.js` использует `INSERT OR REPLACE INTO users`, что SQLite реализует как DELETE + INSERT. При замене строки все колонки сбрасываются к дефолтным значениям, в том числе `notify = 0`. Пользователи, подписавшиеся на уведомления (`notify = 1`), теряют подписку при повторном шаринге номера телефона.

Исправление — заменить `INSERT OR REPLACE` на upsert через `INSERT INTO ... ON CONFLICT(user_id) DO UPDATE SET phone_number = excluded.phone_number`. Это обновляет только `phone_number`, не затрагивая `notify`.

## Glossary

- **Bug_Condition (C)**: Условие проявления бага — вызов `savePhone` с уже существующим `user_id`, когда в базе `notify = 1`
- **Property (P)**: Ожидаемое поведение при срабатывании C — `phone_number` обновляется, `notify` остаётся без изменений
- **Preservation**: Существующее поведение, которое не должно измениться: создание новых записей с `notify = 0`, работа `setNotify`, `getNotify`, `getSubscribedUsers`
- **savePhone**: Функция в `src/database.js`, сохраняющая номер телефона пользователя по его `user_id`
- **notify**: Булева колонка в таблице `users`, флаг подписки на уведомления (0 = выкл, 1 = вкл)
- **INSERT OR REPLACE**: Синтаксис SQLite, реализованный как DELETE старой строки + INSERT новой — стирает все колонки, не указанные явно
- **Upsert**: `INSERT INTO ... ON CONFLICT DO UPDATE` — обновляет только указанные колонки, не трогая остальные

## Bug Details

### Bug Condition

Баг проявляется когда пользователь с активной подпиской (`notify = 1`) вызывает `savePhone` повторно (например, через `/start` → шаринг номера). Функция `savePhone` использует `INSERT OR REPLACE`, что триггерит удаление строки и вставку новой — `notify` при этом принимает дефолтное значение `0`.

**Formal Specification:**
```
FUNCTION isBugCondition(userId, phone)
  INPUT: userId INTEGER, phone TEXT
  OUTPUT: boolean

  existingUser := SELECT * FROM users WHERE user_id = userId
  RETURN existingUser IS NOT NULL
         AND existingUser.notify = 1
END FUNCTION
```

### Examples

- Пользователь подписан (`notify = 1`), повторно делится номером → `notify` становится `0`, уведомления перестают приходить
- Пользователь меняет номер телефона через `/start` → подписка сбрасывается
- Пользователь впервые делится номером (новая запись) → поведение корректное, `notify = 0` по умолчанию (баг не проявляется)
- `setNotify(userId, true)` для существующего пользователя → корректно (`UPDATE` не затрагивает `phone_number`)

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Первый шаринг номера телефона создаёт новую запись с `notify = 0` по умолчанию
- `setNotify(userId, true/false)` устанавливает `notify` корректно и независимо от `savePhone`
- `getNotify(userId)` возвращает актуальное значение флага подписки
- `getSubscribedUsers()` возвращает только пользователей с `notify = 1`

**Scope:**
Все вызовы `savePhone` с новым `user_id` (первый шаринг) и весь остальной код, работающий с `notify`, не должны быть затронуты исправлением. Исправление ограничено только поведением при upsert в `savePhone`.

## Hypothesized Root Cause

1. **INSERT OR REPLACE как DELETE + INSERT**: SQLite реализует `INSERT OR REPLACE` (синоним `INSERT OR REPLACE INTO`) как полное удаление конфликтующей строки и вставку новой. Колонки, не указанные в `INSERT`, получают дефолтные значения. `notify` не передаётся в `savePhone`, поэтому всегда становится `0`.

2. **Отсутствие разделения INSERT и UPDATE**: Функция `savePhone` не различает случай "новый пользователь" и "обновление номера". Оба пути идут через один и тот же `INSERT OR REPLACE`.

3. **Дефолтное значение колонки**: `notify BOOLEAN DEFAULT 0` — корректное дефолтное значение для новых записей, но оно становится проблемой при замене существующих строк через `INSERT OR REPLACE`.

## Correctness Properties

Property 1: Bug Condition - Сохранение notify при обновлении номера телефона

_For any_ вызова `savePhone(userId, phone)` где `isBugCondition(userId, phone)` возвращает `true` (пользователь уже существует с `notify = 1`), исправленная функция SHALL обновить `phone_number` и сохранить `notify = 1` без изменений.

**Validates: Requirements 2.1, 2.2**

Property 2: Preservation - Поведение для новых пользователей и прочих операций

_For any_ вызова `savePhone(userId, phone)` где `isBugCondition(userId, phone)` возвращает `false` (новый пользователь или `notify = 0`), исправленная функция SHALL создать/обновить запись с тем же результатом, что и оригинальная функция, сохраняя все остальные операции с `notify` без изменений.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4**

## Fix Implementation

### Changes Required

**File**: `src/database.js`

**Function**: `savePhone`

**Specific Changes**:

1. **Заменить INSERT OR REPLACE на upsert**: Изменить SQL-запрос с `INSERT OR REPLACE INTO users (user_id, phone_number) VALUES (?, ?)` на `INSERT INTO users (user_id, phone_number) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET phone_number = excluded.phone_number`

   - `ON CONFLICT(user_id)` — триггерит при конфликте первичного ключа
   - `DO UPDATE SET phone_number = excluded.phone_number` — обновляет только `phone_number`
   - `notify` и `created_at` при этом не затрагиваются

**Итоговый код:**
```javascript
function savePhone(userId, phone) {
    const stmt = db.prepare(
        'INSERT INTO users (user_id, phone_number) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET phone_number = excluded.phone_number'
    );
    const formattedPhone = phone.replace(/\D/g, '');
    stmt.run(userId, formattedPhone);
}
```

## Testing Strategy

### Validation Approach

Двухфазный подход: сначала воспроизвести баг на оригинальном коде (exploratory), затем подтвердить исправление и отсутствие регрессий.

### Exploratory Bug Condition Checking

**Goal**: Воспроизвести баг до применения исправления и подтвердить корневую причину.

**Test Plan**: Создать пользователя в БД с `notify = 1`, вызвать `savePhone` с тем же `user_id`, проверить что `notify` стало `0`. Запустить тест на НЕИСПРАВЛЕННОМ коде — он должен упасть.

**Test Cases**:
1. **Повторный savePhone с notify=1**: Создать запись с `notify = 1`, вызвать `savePhone` с тем же `user_id` → ожидаем `notify = 1`, но получаем `0` (упадёт на неисправленном коде)
2. **Повторный savePhone с другим номером**: Тот же сценарий, но с изменением номера телефона → баг аналогичен
3. **Первый savePhone для нового пользователя**: Вызвать `savePhone` для несуществующего `user_id` → `notify = 0` (этот тест должен пройти и до, и после исправления)

**Expected Counterexamples**:
- После вызова `savePhone` для существующего пользователя `notify` оказывается `0` вместо `1`
- Причина: `INSERT OR REPLACE` удаляет строку и вставляет новую без `notify`

### Fix Checking

**Goal**: Убедиться что для всех входных данных, удовлетворяющих `isBugCondition`, исправленная функция сохраняет `notify`.

**Pseudocode:**
```
FOR ALL (userId, phone) WHERE isBugCondition(userId, phone) DO
  savePhone_fixed(userId, phone)
  result := getNotify(userId)
  ASSERT result = 1
END FOR
```

### Preservation Checking

**Goal**: Убедиться что для входных данных, не удовлетворяющих `isBugCondition`, поведение не изменилось.

**Pseudocode:**
```
FOR ALL (userId, phone) WHERE NOT isBugCondition(userId, phone) DO
  ASSERT savePhone_original(userId, phone) produces same row state
         AS savePhone_fixed(userId, phone)
END FOR
```

**Testing Approach**: Рекомендуется property-based testing для preservation checking, потому что:
- Автоматически генерирует множество тест-кейсов по всему входному пространству
- Отлавливает граничные случаи, которые сложно предусмотреть вручную
- Даёт сильные гарантии сохранения поведения для всех «небагованных» входных данных

**Test Cases**:
1. **Preservation новых пользователей**: Первый `savePhone` всегда создаёт запись с `notify = 0`
2. **Preservation setNotify**: `setNotify` корректно устанавливает `notify` до и после исправления
3. **Preservation getSubscribedUsers**: После исправления `getSubscribedUsers` возвращает тот же список подписчиков

### Unit Tests

- Тест: `savePhone` для существующего пользователя с `notify = 1` сохраняет `notify = 1`
- Тест: `savePhone` для нового пользователя создаёт запись с `notify = 0`
- Тест: `savePhone` обновляет `phone_number` корректно при повторном вызове
- Тест: `savePhone` не затрагивает `created_at` при обновлении

### Property-Based Tests

- Генерировать случайные `userId` с `notify = 1`, вызывать `savePhone` — `notify` всегда остаётся `1`
- Генерировать случайные новые `userId` — `savePhone` всегда создаёт запись с `notify = 0`
- Генерировать случайные последовательности `savePhone` и `setNotify` — `getNotify` всегда отражает последнее значение `setNotify`

### Integration Tests

- Полный сценарий: пользователь делится номером → подписывается на уведомления → повторно делится номером → подписка сохраняется
- Полный сценарий: новый пользователь → `savePhone` → `notify = 0` → `setNotify(true)` → `savePhone` снова → `notify = 1`
- `getSubscribedUsers` после серии `savePhone` возвращает корректный список
