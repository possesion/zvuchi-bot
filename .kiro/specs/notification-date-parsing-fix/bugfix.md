# Bugfix Requirements Document

## Introduction

Lesson reminder notifications are not being sent to users because the `parseLessonDate()` function in `src/notifications.js` expects date strings in format "DD.MM.YYYY HH:MM" (with dot separators), but the AlfaCRM API returns dates in format "YYYY-MM-DD HH:MM:SS" (ISO-like format with dashes). This format mismatch causes the function to return Invalid Date, which produces `NaN` timestamps, preventing `setTimeout()` from scheduling notifications.

**Impact**: All lesson reminder notifications fail silently. While cron jobs run successfully and CRM data is fetched correctly, no notifications are ever sent because `scheduledAt` becomes `null` (NaN serialized in logs).

**Evidence from logs**: All notification scheduling attempts show `scheduledAt: null` despite valid `nextLessonDate` values like "2026-09-05 12:30:01", "2026-09-07 18:30:01", etc.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN `parseLessonDate()` receives a date string in format "YYYY-MM-DD HH:MM:SS" (e.g., "2026-09-05 12:30:01") from CRM API THEN the system attempts to split by '.' which produces a single-element array `["2026-09-07 18:30:01"]`, causing `day`, `month`, `year` destructuring to yield `[undefined, undefined, undefined]` except for the first variable getting the whole string

1.2 WHEN `parseLessonDate()` constructs `new Date(year, month - 1, day, hours, minutes)` with undefined values THEN the system returns an Invalid Date object

1.3 WHEN `lessonDate.getTime()` is called on an Invalid Date THEN the system returns `NaN`

1.4 WHEN `scheduledAt = lessonDate.getTime() - 24 * 60 * 60 * 1000` evaluates to `NaN - 86400000` THEN the system produces `NaN` as the scheduled timestamp

1.5 WHEN `setTimeout(callback, NaN)` is called THEN the system does not schedule the timeout and the notification is never sent

1.6 WHEN logs serialize `scheduledAt: NaN` THEN the system displays `scheduledAt: null` in JSON logs

### Expected Behavior (Correct)

2.1 WHEN `parseLessonDate()` receives a date string in format "YYYY-MM-DD HH:MM:SS" (e.g., "2026-09-05 12:30:01") THEN the system SHALL correctly parse it by splitting on '-' for the date part and extracting year, month, day in the correct order

2.2 WHEN `parseLessonDate()` receives a date string with seconds component "YYYY-MM-DD HH:MM:SS" THEN the system SHALL ignore the seconds component and parse only hours and minutes

2.3 WHEN `parseLessonDate()` constructs a Date object with correctly parsed components THEN the system SHALL return a valid Date object representing the lesson time in the server's timezone

2.4 WHEN `lessonDate.getTime()` is called on a valid Date THEN the system SHALL return a valid Unix timestamp in milliseconds

2.5 WHEN `scheduledAt` is calculated as `lessonDate.getTime() - 24 * 60 * 60 * 1000` with valid timestamp THEN the system SHALL produce a valid timestamp representing 24 hours before the lesson

2.6 WHEN `setTimeout(callback, delay)` is called with a positive delay derived from valid `scheduledAt` THEN the system SHALL schedule the notification to be sent at the correct time

2.7 WHEN logs serialize a valid `scheduledAt` timestamp THEN the system SHALL display the numeric timestamp value in logs

### Unchanged Behavior (Regression Prevention)

3.1 WHEN `extractTime()` receives a date string in format "YYYY-MM-DD HH:MM:SS" THEN the system SHALL CONTINUE TO correctly extract "HH:MM:SS" from the time portion

3.2 WHEN `formatNotificationMessage()` receives valid lesson date and client data THEN the system SHALL CONTINUE TO format messages correctly with extracted time

3.3 WHEN `scheduleNotification()` receives a valid `scheduledAt` timestamp THEN the system SHALL CONTINUE TO calculate delay, check if expired, and set timeout correctly

3.4 WHEN `syncSchedule()` processes users and calls `parseLessonDate()` THEN the system SHALL CONTINUE TO follow the same workflow of parsing dates, calculating timestamps, storing in database, and scheduling notifications

3.5 WHEN notification is sent via `setTimeout` callback THEN the system SHALL CONTINUE TO verify the record exists, check if already sent, use atomic `markSent()`, and send the Telegram message

3.6 WHEN date parsing succeeds THEN the system SHALL CONTINUE TO store schedules in the database with the same schema (user_id, next_lesson_date, scheduled_at, name, paid_count, sent)

## Bug Condition Formalization

### Bug Condition Function

```pascal
FUNCTION isBugCondition(X)
  INPUT: X of type String (date string)
  OUTPUT: boolean
  
  // Returns true when the input is in ISO-like format that current parser cannot handle
  RETURN X matches pattern "YYYY-MM-DD HH:MM:SS" (with dashes, not dots)
END FUNCTION
```

**Example buggy inputs**:
- `"2026-09-05 12:30:01"`
- `"2026-09-07 18:30:01"`
- `"2026-09-09 17:30:01"`

### Property Specification

```pascal
// Property: Fix Checking - Date Parsing for ISO Format
FOR ALL X WHERE isBugCondition(X) DO
  result ← parseLessonDate'(X)
  ASSERT result is a valid Date object
  ASSERT result.getTime() returns a valid timestamp (not NaN)
  ASSERT extracted date components match input (year, month, day, hours, minutes)
END FOR
```

### Preservation Goal

```pascal
// Property: Preservation Checking
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT parseLessonDate(X) = parseLessonDate'(X)
END FOR
```

**Note**: Based on code review, the current implementation only receives ISO format "YYYY-MM-DD HH:MM:SS" from CRM API. The old "DD.MM.YYYY HH:MM" format mentioned in the code comment appears to be outdated documentation. Therefore, the preservation set may be empty (no valid non-buggy inputs exist in production), but the preservation property ensures that if any other date format were to be used, the fix would be evaluated for compatibility.
