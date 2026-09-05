# Timezone Docker Fix - Bugfix Design

## Overview

Этот bugfix устраняет некорректную обработку московского времени в Docker-контейнере с UTC timezone. Проблема заключается в том, что функция `parseLessonDate()` интерпретирует даты из CRM (всегда в MSK) как локальное время сервера, что приводит к смещению уведомлений на 3 часа в production. Дополнительно, cron-задача синхронизации не работает корректно в Docker без timezone данных.

**Решение**: Явная конвертация MSK ↔ UTC через математические операции (+3/-3 часа) без внешних библиотек. Функция `parseLessonDate()` будет создавать Date объект в UTC с правильным смещением, а cron будет настроен на выполнение в 21:00 UTC (что соответствует 00:00 MSK следующего дня).

**Масштаб изменений**:
- `src/notifications.js`: модификация функции `parseLessonDate()`
- `index.js`: изменение cron расписания с `'0 0 * * *'` на `'0 21 * * *'` и удаление параметра `timezone`

## Glossary

- **Bug_Condition (C)**: Условие, при котором проявляется баг - сервер работает в UTC timezone и обрабатывает даты из CRM в московском времени
- **Property (P)**: Желаемое поведение - даты из CRM интерпретируются как MSK независимо от timezone сервера
- **Preservation**: Существующее поведение парсинга, валидации и планирования, которое должно остаться неизменным
- **parseLessonDate()**: Функция в `src/notifications.js`, которая преобразует строку даты из CRM в объект Date
- **MSK (Moscow Standard Time)**: UTC+3, постоянное смещение без перехода на летнее время
- **Cron expression**: Расписание выполнения задачи в формате `'минута час день месяц день_недели'`
- **Timestamp**: Unix timestamp в миллисекундах, используется для планирования уведомлений

## Bug Details

### Bug Condition

Баг проявляется когда Docker-контейнер работает в UTC timezone и система обрабатывает даты из AlfaCRM API. Функция `parseLessonDate()` использует конструктор `new Date(year, month, day, hours, minutes)`, который создаёт объект Date в локальном часовом поясе сервера. В результате, дата `"2026-09-05 12:30:01"` (MSK) интерпретируется как `2026-09-05 12:30 UTC`, что на 3 часа позже реального времени.

**Formal Specification:**
```
FUNCTION isBugCondition(environment, dateString)
  INPUT: environment of type Environment, dateString of type String
  OUTPUT: boolean
  
  RETURN (environment.serverTimezone == "UTC")
         AND (dateString.source == "AlfaCRM_API")
         AND (dateString.implicitTimezone == "MSK")
         AND (dateString.format == "YYYY-MM-DD HH:MM:SS")
END FUNCTION
```

### Examples

- **Example 1 (Basic Case)**: 
  - Input: `"2026-09-05 12:30:01"` в UTC окружении
  - Current: Date объект с timestamp `1788525000000` (2026-09-05T12:30:00.000Z)
  - Expected: Date объект с timestamp `1788514200000` (2026-09-05T09:30:00.000Z)
  - Difference: +3 часа смещение

- **Example 2 (Notification Scheduling)**:
  - Input: урок в `"2026-09-05 12:30:01"` MSK
  - Current: уведомление планируется на 2026-09-04T12:30:00.000Z
  - Expected: уведомление планируется на 2026-09-04T09:30:00.000Z
  - Impact: пользователь получает уведомление на 3 часа позже

- **Example 3 (Cron Schedule)**:
  - Input: `cron.schedule('0 0 * * *', callback, { timezone: 'Europe/Moscow' })`
  - Current: выполняется в 00:00 UTC (21:00 MSK предыдущего дня) или не работает вообще
  - Expected: выполняется в 21:00 UTC (00:00 MSK следующего дня)

- **Edge Case (Midnight Boundary)**: 
  - Input: `"2026-09-05 00:30:01"` MSK
  - Expected: должно корректно обработаться как 2026-09-04T21:30:00.000Z
  - Проверяет корректность работы при переходе через границу суток

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Функция `parseLessonDate()` должна продолжать успешно парсить валидные строки формата `"YYYY-MM-DD HH:MM:SS"`
- Функция должна продолжать возвращать Invalid Date для некорректных входных данных
- Функция `scheduleNotification()` должна продолжать корректно рассчитывать время отправки (lessonDate - 24 часа)
- Множественные уведомления для разных пользователей должны планироваться независимо
- Cron callback должен продолжать вызываться с теми же параметрами
- API запросы к AlfaCRM должны остаться неизменными по формату и структуре
- Healthcheck endpoint `/users` должен возвращать данные в том же формате

**Scope:**
Все входные данные, которые НЕ являются датами из CRM в московском времени, должны быть полностью не затронуты этим фиксом. Это включает:
- Обработку других полей из CRM API (name, paid_count, и т.д.)
- Работу функций `extractTime()`, `formatNotificationMessage()`
- Логику БД операций (setSchedule, clearSchedule, getSchedule)
- Поведение функции в локальном MSK окружении

## Hypothesized Root Cause

На основе анализа кода и описания бага, выявлены следующие причины:

1. **Использование локального часового пояса в Date конструкторе**: Функция `parseLessonDate()` использует `new Date(year, month - 1, day, hours, minutes)`, который создаёт объект в локальном timezone сервера. В Docker с UTC это приводит к интерпретации московского времени как UTC.

2. **Неправильная настройка cron**: Параметр `timezone: 'Europe/Moscow'` в `cron.schedule()` не работает в Docker-контейнере без установленных timezone данных. Библиотека node-cron либо игнорирует этот параметр, либо падает с ошибкой.

3. **Отсутствие явного указания часового пояса**: Код не содержит явной информации о том, что все даты из CRM находятся в MSK timezone. Это неявное предположение работает только в локальном окружении с MSK.

4. **Зависимость от системной конфигурации**: Решение полагается на то, что сервер настроен на московский часовой пояс, что не гарантируется в Docker без дополнительной конфигурации.

## Correctness Properties

Property 1: Bug Condition - MSK Date Parsing

_For any_ date string from CRM in format "YYYY-MM-DD HH:MM:SS" representing Moscow time, the fixed `parseLessonDate()` function SHALL create a Date object with correct UTC timestamp (MSK time - 3 hours), ensuring notifications are scheduled at the correct time regardless of server timezone.

**Validates: Requirements 2.1, 2.2, 2.3**

Property 2: Preservation - Non-CRM Date Handling

_For any_ input where the bug condition does NOT hold (valid/invalid date strings processed in any timezone context), the fixed function SHALL produce the same parsing behavior as the original function, preserving successful parsing for valid inputs and Invalid Date returns for invalid inputs.

**Validates: Requirements 3.1, 3.2, 3.3, 3.9**

Property 3: Cron Execution Time

_For any_ date when the cron task is scheduled to run, the fixed cron configuration SHALL execute the synchronization callback at 21:00 UTC (which equals 00:00 MSK of the next day), ensuring consistent daily sync regardless of Docker timezone configuration.

**Validates: Requirements 2.4, 2.5**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

**File**: `src/notifications.js`

**Function**: `parseLessonDate(dateString)`

**Specific Changes**:
1. **Parse date components**: Сохраняем существующий парсинг строки на компоненты (year, month, day, hours, minutes)

2. **Create UTC Date object**: Вместо `new Date(year, month - 1, day, hours, minutes)` используем `Date.UTC()`:
   ```javascript
   const utcTimestamp = Date.UTC(year, month - 1, day, hours, minutes);
   ```

3. **Apply MSK offset**: Вычитаем 3 часа (10800000 ms), так как дата в MSK, а нам нужна UTC:
   ```javascript
   const mskOffset = 3 * 60 * 60 * 1000; // 3 hours in milliseconds
   const correctedTimestamp = utcTimestamp - mskOffset;
   ```

4. **Return Date object**: Создаём финальный Date объект из скорректированного timestamp:
   ```javascript
   return new Date(correctedTimestamp);
   ```

5. **Update comments**: Обновляем комментарий функции, чтобы отразить новый алгоритм конвертации

**File**: `index.js`

**Cron Schedule Configuration**

**Specific Changes**:
1. **Change cron expression**: Изменяем с `'0 0 * * *'` на `'0 21 * * *'` (выполнение в 21:00 UTC)

2. **Remove timezone parameter**: Удаляем объект `{ timezone: 'Europe/Moscow' }` из вызова `cron.schedule()`

3. **Update comment**: Обновляем комментарий, объясняющий что 21:00 UTC = 00:00 MSK следующего дня

**Rationale**: 
- Математическая конвертация MSK → UTC более надёжна, чем зависимость от системного timezone
- Нет зависимости от внешних библиотек или переменных окружения
- Cron с UTC временем работает везде без дополнительной конфигурации
- Решение прозрачно и легко понимается

## Testing Strategy

### Validation Approach

Стратегия тестирования следует двухфазному подходу: сначала демонстрируем баг на нефиксированном коде через exploratory tests, затем проверяем, что фикс работает корректно и сохраняет существующее поведение.

### Exploratory Bug Condition Checking

**Goal**: Продемонстрировать баг ДО внедрения фикса. Подтвердить или опровергнуть анализ первопричины. Если опровергнем - нужно пересмотреть гипотезу.

**Test Plan**: Создать тесты, которые симулируют UTC окружение и вызывают `parseLessonDate()` с датами из CRM. Запустить их на НЕФИКСИРОВАННОМ коде для наблюдения ошибочного поведения и понимания root cause.

**Test Cases**:
1. **UTC Environment Parsing**: Вызвать `parseLessonDate("2026-09-05 12:30:01")` в UTC окружении (будет фейлить на нефиксированном коде - смещение +3 часа)
2. **Notification Timestamp Calculation**: Проверить что timestamp для уведомления за 24 часа смещён на +3 часа (будет фейлить на нефиксированном коде)
3. **Midnight Boundary Case**: Тестировать `parseLessonDate("2026-09-05 00:30:01")` для проверки перехода через границу суток (может фейлить на нефиксированном коде)
4. **Cron Timezone Behavior**: Проверить когда фактически выполняется cron с параметром `timezone: 'Europe/Moscow'` в Docker (может фейлить или вообще не выполняться)

**Expected Counterexamples**:
- Timestamp будет на 10800000 мс (3 часа) больше ожидаемого
- Уведомления будут запланированы на неправильное время
- Возможные причины: использование локального timezone в Date конструкторе, неработающий timezone параметр в cron

### Fix Checking

**Goal**: Проверить, что для всех входных данных, где выполняется bug condition, исправленная функция выдаёт ожидаемое поведение.

**Pseudocode:**
```
FOR ALL dateString WHERE dateString.isFromCRM = true DO
  result := parseLessonDate'(dateString)
  expectedUTC := interpretDateAsUTC(dateString, mskOffset = -3)
  ASSERT result.getTime() == expectedUTC.getTime()
  ASSERT result.toISOString() ends with correct UTC representation
END FOR
```

### Preservation Checking

**Goal**: Проверить, что для всех входных данных, где НЕ выполняется bug condition, исправленная функция выдаёт тот же результат, что и оригинальная.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  // Для валидных дат - успешный парсинг должен сохраниться
  IF input.isValidFormat == true THEN
    ASSERT parseLessonDate'(input).isValid == parseLessonDate(input).isValid
  END IF
  
  // Для невалидных дат - Invalid Date должен сохраниться
  IF input.isValidFormat == false THEN
    ASSERT isNaN(parseLessonDate'(input).getTime())
    ASSERT isNaN(parseLessonDate(input).getTime())
  END IF
END FOR
```

**Testing Approach**: Property-based testing рекомендуется для preservation checking, потому что:
- Автоматически генерирует много тестовых случаев по всему диапазону входных данных
- Ловит edge cases, которые могут быть пропущены в ручных unit тестах
- Даёт сильные гарантии, что поведение не изменилось для всех не-багги входных данных

**Test Plan**: Сначала наблюдаем поведение на НЕФИКСИРОВАННОМ коде для валидных и невалидных входных данных, затем пишем property-based тесты, захватывающие это поведение.

**Test Cases**:
1. **Valid Date Format Preservation**: Наблюдаем, что валидные даты успешно парсятся на нефиксированном коде, затем пишем тест для проверки что это продолжает работать после фикса
2. **Invalid Date Format Preservation**: Наблюдаем, что невалидные даты возвращают Invalid Date на нефиксированном коде, затем пишем тест для проверки что это сохраняется после фикса
3. **Time Extraction Preservation**: Проверяем, что `extractTime()` продолжает работать идентично
4. **Message Formatting Preservation**: Проверяем, что `formatNotificationMessage()` использует время корректно

### Unit Tests

- Тест парсинга конкретных дат с известными ожидаемыми UTC timestamps
- Тест edge cases (полночь, 23:59, начало/конец месяца)
- Тест невалидных входных данных (пустая строка, некорректный формат, несуществующие даты)
- Тест что вспомогательные функции (`extractTime`, `formatNotificationMessage`) продолжают работать

### Property-Based Tests

- Генерация случайных валидных дат в формате CRM и проверка корректности MSK → UTC конвертации
- Генерация случайных невалидных строк и проверка что возвращается Invalid Date
- Тестирование на большом количестве сценариев для гарантии отсутствия регрессий

### Integration Tests

- Полный flow: получение данных из CRM (мок) → парсинг даты → планирование уведомления → проверка корректного timestamp
- Тест cron выполнения: проверка что callback вызывается в правильное время (может быть сложно без time mocking)
- Тест восстановления расписаний при рестарте бота с существующими записями в БД
