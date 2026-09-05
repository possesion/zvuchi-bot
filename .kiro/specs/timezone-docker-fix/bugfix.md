# Bugfix Requirements Document

## Introduction

Бот некорректно обрабатывает даты в Docker-контейнере из-за различий в часовых поясах между локальной разработкой (MSK/UTC+3) и production окружением (UTC). Это приводит к двум критическим проблемам:

1. **Смещение уведомлений на 3 часа**: Функция `parseLessonDate()` интерпретирует даты из CRM (которые всегда в московском времени) как даты в локальном часовом поясе сервера, что приводит к неправильному расчету времени отправки уведомлений.

2. **Некорректное время синхронизации**: Cron-задача для ежедневной синхронизации с CRM должна выполняться в 00:00 MSK, но в Docker-контейнере без timezone данных может выполняться в 00:00 UTC (на 3 часа раньше) или не работать вообще.

**Масштаб воздействия:**
- Все пользователи получают уведомления о занятиях в неправильное время (на 3 часа позже ожидаемого в production)
- Синхронизация данных с CRM происходит в неправильное время
- Проблема проявляется только в Docker-контейнере, локально бот работает корректно

**Примеры из production:**
- CRM возвращает: `"next_lesson_date": "2026-09-05 12:30:01"` (MSK)
- Ожидаемое уведомление: `2026-09-04 09:30 UTC` (за 24 часа до 12:30 MSK)
- Фактическое: `2026-09-04 12:30 UTC` (смещение +3 часа)

## Bug Analysis

### Bug Condition

**Bug Condition Function** - Идентифицирует условия, при которых проявляется баг:

```pascal
FUNCTION isBugCondition(environment, dateString)
  INPUT: environment of type Environment, dateString of type String
  OUTPUT: boolean
  
  // Баг проявляется когда:
  // 1. Контейнер работает в часовом поясе UTC (не MSK)
  // 2. Обрабатывается дата из CRM в формате московского времени
  RETURN (environment.timezone ≠ "Europe/Moscow" OR environment.timezone ≠ "MSK") 
         AND dateString.isFromCRM = true
         AND dateString.implicitTimezone = "MSK"
END FUNCTION
```

**Конкретные условия бага:**
- Сервер работает в Docker-контейнере с UTC timezone
- Функция `parseLessonDate()` получает строку даты из AlfaCRM API (всегда в MSK)
- Cron-задача настроена на выполнение в определенное московское время

### Current Behavior (Defect)

**Problem 1: Date Parsing**

1.1 WHEN сервер работает в UTC timezone И `parseLessonDate()` получает строку `"2026-09-05 12:30:01"` из CRM (московское время) THEN система создает объект Date с интерпретацией этой строки как UTC времени, что приводит к смещению на +3 часа (timestamp `1788525000000` вместо `1788514200000`)

1.2 WHEN сервер работает в UTC timezone И система планирует уведомление за 24 часа до занятия на основе неправильно распарсенной даты THEN уведомление запланировано на `2026-09-04 12:30 UTC` вместо `2026-09-04 09:30 UTC` (смещение на +3 часа)

1.3 WHEN сервер работает в UTC timezone И система сравнивает текущее время с временем занятия для определения необходимости отправки уведомления THEN сравнение происходит с неправильным timestamp, что приводит к отправке уведомлений в неправильное время

**Problem 2: Cron Scheduling**

1.4 WHEN Docker-контейнер не имеет timezone данных для `Europe/Moscow` И cron.schedule вызывается с параметром `timezone: 'Europe/Moscow'` THEN либо параметр игнорируется и задача выполняется в 00:00 UTC (на 3 часа раньше), либо возникает ошибка и задача не выполняется вообще

1.5 WHEN cron-задача синхронизации выполняется в 00:00 UTC вместо 00:00 MSK THEN синхронизация происходит в 03:00 MSK, что может привести к задержкам в обновлении данных о занятиях

### Expected Behavior (Correct)

**Problem 1: Date Parsing**

2.1 WHEN `parseLessonDate()` получает строку `"2026-09-05 12:30:01"` из CRM THEN система SHALL создать объект Date с корректной интерпретацией этой строки как московского времени (UTC+3), возвращая timestamp `1788514200000`, независимо от часового пояса сервера

2.2 WHEN система планирует уведомление за 24 часа до занятия THEN уведомление SHALL быть запланировано на правильное время `2026-09-04 09:30 UTC` (что соответствует `2026-09-05 09:30 MSK`, за 24 часа до занятия в 12:30 MSK)

2.3 WHEN система сравнивает текущее время с временем занятия THEN сравнение SHALL происходить с правильным UTC timestamp, обеспечивая отправку уведомлений в корректное время

**Problem 2: Cron Scheduling**

2.4 WHEN система запускается в Docker-контейнере с UTC timezone THEN cron-задача синхронизации SHALL выполняться в 00:00 по московскому времени (21:00 предыдущего дня UTC), независимо от наличия timezone данных в контейнере

2.5 WHEN наступает время выполнения cron-задачи THEN синхронизация с CRM SHALL происходить стабильно и надежно в 00:00 MSK каждый день

### Unchanged Behavior (Regression Prevention)

**Date Parsing Preservation**

3.1 WHEN `parseLessonDate()` получает корректную строку даты в формате `"YYYY-MM-DD HH:MM:SS"` THEN система SHALL CONTINUE TO успешно парсить эту строку и возвращать валидный объект Date

3.2 WHEN `parseLessonDate()` получает некорректную строку даты THEN система SHALL CONTINUE TO возвращать Invalid Date, как и раньше

3.3 WHEN система работает в локальном окружении с MSK timezone THEN `parseLessonDate()` SHALL CONTINUE TO возвращать корректные результаты (поведение не должно сломаться для локальной разработки)

**Notification Scheduling Preservation**

3.4 WHEN `scheduleNotification()` получает корректно распарсенную дату занятия THEN система SHALL CONTINUE TO рассчитывать правильное время для отправки уведомления за 24 часа

3.5 WHEN система планирует несколько уведомлений для разных пользователей THEN каждое уведомление SHALL CONTINUE TO быть запланировано независимо и корректно

**Cron Scheduling Preservation**

3.6 WHEN cron-задача выполняется в назначенное время THEN функция `syncSchedule()` SHALL CONTINUE TO вызываться с правильными параметрами

3.7 WHEN происходит ошибка во время выполнения cron-задачи THEN ошибка SHALL CONTINUE TO логироваться, но не останавливать последующие выполнения задачи

**API and Integration Preservation**

3.8 WHEN система запрашивает данные из AlfaCRM API THEN формат и структура запросов SHALL CONTINUE TO оставаться неизменными

3.9 WHEN система получает ответ от AlfaCRM API THEN парсинг всех полей кроме дат SHALL CONTINUE TO работать идентично текущей реализации

3.10 WHEN healthcheck endpoint `/users` возвращает данные THEN формат ответа (включая поле `scheduled_at`) SHALL CONTINUE TO соответствовать текущему формату

**Test Suite Preservation**

3.11 WHEN существующие тесты `parseLessonDate.bugcondition.test.js` выполняются THEN они SHALL CONTINUE TO корректно проверять поведение в условиях бага

3.12 WHEN существующие тесты `parseLessonDate.preservation.test.js` выполняются THEN они SHALL CONTINUE TO корректно проверять сохранение поведения для не-багги случаев

## Bug Condition Property Specification

### Fix Checking Property

```pascal
// Property 1: Date Parsing Fix Verification
FOR ALL dateString WHERE dateString.isFromCRM = true DO
  // Original function (buggy in UTC environment)
  resultOld ← parseLessonDate(dateString)  // when server timezone = UTC
  
  // Fixed function
  resultNew ← parseLessonDate'(dateString)  // when server timezone = UTC
  
  // Expected: dates should be interpreted as MSK regardless of server timezone
  expectedTimestamp ← interpretAsMoscowTime(dateString)
  
  ASSERT resultNew.getTime() = expectedTimestamp
  ASSERT abs(resultNew.getTime() - resultOld.getTime()) = 10800000  // 3 hours in ms
END FOR

// Property 2: Cron Scheduling Fix Verification
LET currentServerTime ← getCurrentTime()
LET moscowMidnight ← getMoscowMidnight(currentDate)
LET cronExecutionTime ← getNextCronExecution()

// Fixed cron should execute at MSK midnight regardless of server timezone
ASSERT cronExecutionTime.UTC = moscowMidnight.UTC
ASSERT cronExecutionTime.UTC = (moscowMidnight.MSK - 3 hours)
```

### Preservation Checking Property

```pascal
// Property 3: Preservation of Non-Buggy Behavior
FOR ALL input WHERE NOT isBugCondition(input) DO
  // For local MSK environment, behavior should remain identical
  IF environment.timezone = "Europe/Moscow" OR environment.timezone = "MSK" THEN
    ASSERT parseLessonDate(input) = parseLessonDate'(input)
  END IF
  
  // For all valid date strings, successful parsing must be preserved
  IF input.isValidDateFormat = true THEN
    ASSERT parseLessonDate'(input).isValid = parseLessonDate(input).isValid
  END IF
  
  // For invalid inputs, error behavior must be preserved
  IF input.isValidDateFormat = false THEN
    ASSERT parseLessonDate'(input).isInvalid = parseLessonDate(input).isInvalid
  END IF
END FOR

// Property 4: API Integration Preservation
FOR ALL apiResponse WHERE apiResponse.source = "AlfaCRM" DO
  // All non-date fields should be processed identically
  FOR ALL field WHERE field ≠ "next_lesson_date" AND field ≠ "date" DO
    ASSERT processField'(field) = processField(field)
  END IF
END FOR
```

## Concrete Examples

### Example 1: Date Parsing in UTC Environment

**Input:**
- Server timezone: UTC
- CRM date string: `"2026-09-05 12:30:01"`
- This represents: September 5, 2026, 12:30 PM Moscow Time

**Current (Buggy) Behavior:**
```javascript
parseLessonDate("2026-09-05 12:30:01")
// Returns: Date object representing 2026-09-05 12:30 UTC
// Timestamp: 1788525000000
// ISO: "2026-09-05T12:30:00.000Z"
```

**Expected (Fixed) Behavior:**
```javascript
parseLessonDate'("2026-09-05 12:30:01")
// Returns: Date object representing 2026-09-05 12:30 MSK = 2026-09-05 09:30 UTC
// Timestamp: 1788514200000
// ISO: "2026-09-05T09:30:00.000Z"
```

### Example 2: Notification Scheduling

**Input:**
- Lesson date from CRM: `"2026-09-05 12:30:01"` (MSK)
- Notification should be sent 24 hours before

**Current (Buggy) Behavior:**
```javascript
const lessonDate = parseLessonDate("2026-09-05 12:30:01");
// lessonDate represents 2026-09-05 12:30 UTC (wrong!)
const notificationTime = new Date(lessonDate.getTime() - 24 * 60 * 60 * 1000);
// notificationTime: 2026-09-04 12:30 UTC
// scheduled_at: 1788525000000 - 86400000 = 1788438600000
```

**Expected (Fixed) Behavior:**
```javascript
const lessonDate = parseLessonDate'("2026-09-05 12:30:01");
// lessonDate represents 2026-09-05 09:30 UTC (correct!)
const notificationTime = new Date(lessonDate.getTime() - 24 * 60 * 60 * 1000);
// notificationTime: 2026-09-04 09:30 UTC
// scheduled_at: 1788514200000 - 86400000 = 1788427800000
```

### Example 3: Cron Schedule

**Current (Buggy) Behavior:**
```javascript
cron.schedule('0 0 * * *', callback, { timezone: 'Europe/Moscow' });
// In Docker without timezone data:
// - Either executes at 00:00 UTC (21:00 previous day MSK) - wrong time
// - Or fails silently - no execution at all
```

**Expected (Fixed) Behavior:**
```javascript
// Solution approach: calculate UTC time for MSK midnight
cron.schedule('0 21 * * *', callback);
// Executes at 21:00 UTC = 00:00 MSK (next day) - correct!
```

## Technical Constraints

1. **No External Dependencies**: Solution must not add new npm packages (no moment-timezone, date-fns-tz, etc.)
2. **No Environment Variables**: Solution must not depend on setting `TZ` environment variable in Docker
3. **Existing Tests**: Must preserve and pass existing test files:
   - `src/parseLessonDate.bugcondition.test.js`
   - `src/parseLessonDate.preservation.test.js`
4. **API Format Preservation**: Cannot change the format of data received from or sent to AlfaCRM
5. **Healthcheck Compatibility**: `/users` endpoint response format must remain unchanged
6. **CommonJS Module System**: Must work with Node.js CommonJS (no ES modules)
7. **Docker Compatibility**: Solution must work in Docker container without additional configuration

## Success Criteria

The bugfix is successful when:

1. ✅ `parseLessonDate()` correctly interprets CRM dates as MSK time regardless of server timezone
2. ✅ Notifications are scheduled at the correct time in production Docker environment
3. ✅ Cron synchronization executes reliably at 00:00 MSK in Docker
4. ✅ All existing tests pass without modification
5. ✅ Behavior in local MSK environment remains unchanged (no regressions)
6. ✅ No new dependencies added
7. ✅ No changes required to Docker configuration or environment variables
