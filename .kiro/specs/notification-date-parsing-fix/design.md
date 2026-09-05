# Notification Date Parsing Bugfix Design

## Overview

The `parseLessonDate()` function in `src/notifications.js` currently expects date strings in format "DD.MM.YYYY HH:MM" (with dot separators), but the AlfaCRM API returns dates in format "YYYY-MM-DD HH:MM:SS" (ISO-like format with dashes). This format mismatch causes Invalid Date objects, producing `NaN` timestamps that prevent `setTimeout()` from scheduling notifications.

This bugfix will update the parser to correctly handle the ISO-like format by:
1. Splitting on '-' instead of '.' for the date portion
2. Extracting year, month, day in the correct order (YYYY-MM-DD instead of DD.MM.YYYY)
3. Ignoring the seconds component from "HH:MM:SS"

The fix ensures all lesson reminder notifications are scheduled correctly while preserving the existing notification workflow.

## Glossary

- **Bug_Condition (C)**: The condition that triggers the bug - when `parseLessonDate()` receives date strings in format "YYYY-MM-DD HH:MM:SS" (ISO-like with dashes)
- **Property (P)**: The desired behavior - `parseLessonDate()` should return a valid Date object with correct year, month, day, hours, minutes extracted from the ISO-like format
- **Preservation**: Existing behavior of `extractTime()`, `formatNotificationMessage()`, `scheduleNotification()`, `syncSchedule()`, and the notification workflow that must remain unchanged
- **parseLessonDate()**: The function in `src/notifications.js` that converts CRM date strings to JavaScript Date objects
- **scheduledAt**: Unix timestamp in milliseconds representing when the notification should be sent (24 hours before lesson time)
- **CRM API**: AlfaCRM v2 API that returns lesson dates in "YYYY-MM-DD HH:MM:SS" format

## Bug Details

### Bug Condition

The bug manifests when the `parseLessonDate()` function receives date strings from the CRM API in format "YYYY-MM-DD HH:MM:SS". The function currently splits by '.' expecting "DD.MM.YYYY HH:MM", which produces incorrect array destructuring, resulting in Invalid Date objects.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type String (date string)
  OUTPUT: boolean
  
  RETURN input matches pattern "YYYY-MM-DD HH:MM:SS"
         AND input contains '-' as date separator (not '.')
         AND NOT parseLessonDate(input).isValid()
END FUNCTION
```

### Examples

- **Input**: `"2026-09-05 12:30:01"`
  - **Current behavior**: `parseLessonDate()` splits by '.' → `["2026-09-05 12:30:01"]` → destructures to `day="2026-09-05 12:30:01"`, `month=undefined`, `year=undefined` → `new Date(undefined, undefined-1, "2026-09-05 12:30:01", 12, 30)` → Invalid Date → `scheduledAt=NaN`
  - **Expected behavior**: Parse as year=2026, month=9, day=5, hours=12, minutes=30 → valid Date object → valid timestamp

- **Input**: `"2026-09-07 18:30:01"`
  - **Current behavior**: Invalid Date → `scheduledAt=NaN` → notification never scheduled
  - **Expected behavior**: Parse as year=2026, month=9, day=7, hours=18, minutes=30 → notification scheduled for 24 hours before

- **Input**: `"2026-09-09 17:30:01"`
  - **Current behavior**: Invalid Date → `scheduledAt=NaN` → notification never scheduled
  - **Expected behavior**: Parse as year=2026, month=9, day=9, hours=17, minutes=30 → notification scheduled for 24 hours before

- **Edge case**: `"2026-12-31 23:59:00"` (year boundary)
  - **Expected behavior**: Parse correctly as year=2026, month=12, day=31, hours=23, minutes=59 → valid Date object

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- `extractTime()` must continue to extract "HH:MM:SS" correctly from "YYYY-MM-DD HH:MM:SS" format
- `formatNotificationMessage()` must continue to format messages correctly with extracted time
- `scheduleNotification()` must continue to calculate delay, check if expired, and set timeout correctly
- `syncSchedule()` workflow must continue: parse dates → calculate timestamps → store in database → schedule notifications
- Notification sending via `setTimeout` callback must continue: verify record exists → check if already sent → use atomic `markSent()` → send Telegram message
- Database schema must remain unchanged: (user_id, next_lesson_date, scheduled_at, name, paid_count, sent)

**Scope:**
All functionality that does NOT involve parsing the date string into a Date object should be completely unaffected by this fix. This includes:
- Time extraction from date strings
- Message formatting
- Notification scheduling logic (delay calculation, timeout setting)
- Database operations
- CRM API calls and data fetching
- Bot message sending

## Hypothesized Root Cause

Based on the bug description and code analysis, the root cause is:

1. **Incorrect Date Format Assumption**: The function expects "DD.MM.YYYY HH:MM" (European format with dots) but receives "YYYY-MM-DD HH:MM:SS" (ISO-like format with dashes)
   - The comment in the code says `"15.07.2025 10:30" -> Date(2025, 6, 15, 10, 30)` showing the expected format
   - The actual CRM API returns `"2026-09-05 12:30:01"` format

2. **Incorrect Separator**: The code splits `datePart` by '.' which doesn't work for dash-separated dates
   - `"2026-09-05".split('.')` returns `["2026-09-05"]` (single-element array)
   - Destructuring `[day, month, year]` assigns the full string to `day`, leaving `month` and `year` as `undefined`

3. **Incorrect Component Order**: Even if splitting worked, the destructuring order is wrong
   - Code expects `[day, month, year]` for "DD.MM.YYYY" format
   - Actual format is "YYYY-MM-DD" requiring `[year, month, day]` order

4. **Missing Seconds Handling**: The time part "HH:MM:SS" needs to ignore the seconds component
   - Current code splits by ':' which works, but doesn't explicitly handle the 3-element array

## Correctness Properties

Property 1: Bug Condition - Date Parsing for ISO Format

_For any_ input date string in format "YYYY-MM-DD HH:MM:SS" (e.g., "2026-09-05 12:30:01"), the fixed parseLessonDate function SHALL return a valid Date object with year=2026, month=September (8 in 0-indexed), day=5, hours=12, minutes=30, and the resulting timestamp SHALL be a valid number (not NaN).

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7**

Property 2: Preservation - Notification Workflow Unchanged

_For any_ input that is NOT the date string itself (bot instance, user IDs, CRM data, notification messages), the fixed code SHALL produce exactly the same behavior as the original code, preserving all functionality of `extractTime()`, `formatNotificationMessage()`, `scheduleNotification()`, `syncSchedule()`, and the notification sending workflow.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

**File**: `src/notifications.js`

**Function**: `parseLessonDate(dateString)`

**Specific Changes**:
1. **Update Date Separator**: Change from splitting by '.' to splitting by '-' for the date part
   - Current: `const [day, month, year] = datePart.split('.').map(Number);`
   - Fixed: `const [year, month, day] = datePart.split('-').map(Number);`

2. **Correct Component Order**: Reorder destructuring to match YYYY-MM-DD format
   - Current: `[day, month, year]` expects DD.MM.YYYY
   - Fixed: `[year, month, day]` matches YYYY-MM-DD

3. **Handle Seconds in Time**: Ensure only HH and MM are extracted, ignoring SS
   - Current: `const [hours, minutes] = timePart.split(':').map(Number);`
   - Fixed: Same code works (automatically ignores third element), but should be explicit for clarity

4. **Update Function Comment**: Correct the example in the JSDoc comment
   - Current: `// "15.07.2025 10:30" -> Date(2025, 6, 15, 10, 30)`
   - Fixed: `// "2026-09-05 12:30:01" -> Date(2026, 8, 5, 12, 30)`

5. **Verify No Timezone Issues**: The current implementation uses `new Date(year, month, day, hours, minutes)` which creates a Date in the local timezone of the server
   - This is correct if the server runs in Moscow timezone (UTC+3)
   - The fix preserves this behavior

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code, then verify the fix works correctly and preserves existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm or refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: Write tests that call `parseLessonDate()` with various ISO-like format date strings and assert that the returned Date object is valid and has correct components. Run these tests on the UNFIXED code to observe failures and understand the root cause.

**Test Cases**:
1. **Standard ISO Format Test**: Call `parseLessonDate("2026-09-05 12:30:01")` and assert the Date is valid (will fail on unfixed code - returns Invalid Date)
2. **Different Month Test**: Call `parseLessonDate("2026-12-15 18:45:30")` and verify month=December (will fail on unfixed code)
3. **Midnight Test**: Call `parseLessonDate("2026-01-01 00:00:00")` and verify hours=0, minutes=0 (will fail on unfixed code)
4. **Year Boundary Test**: Call `parseLessonDate("2026-12-31 23:59:59")` and verify correct date components (will fail on unfixed code)

**Expected Counterexamples**:
- `parseLessonDate("2026-09-05 12:30:01")` returns Invalid Date (not a valid Date object)
- `lessonDate.getTime()` returns `NaN` instead of a valid timestamp
- Possible causes: incorrect separator ('.'), incorrect component order ([day, month, year] vs [year, month, day]), missing seconds handling

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := parseLessonDate_fixed(input)
  ASSERT result is a valid Date object
  ASSERT result.getTime() returns a valid number (not NaN)
  ASSERT result.getFullYear() equals extracted year
  ASSERT result.getMonth() equals extracted month - 1 (0-indexed)
  ASSERT result.getDate() equals extracted day
  ASSERT result.getHours() equals extracted hours
  ASSERT result.getMinutes() equals extracted minutes
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT parseLessonDate_original(input) = parseLessonDate_fixed(input)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain
- It catches edge cases that manual unit tests might miss
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs

**Test Plan**: Observe behavior on UNFIXED code first for other date formats or edge cases, then write property-based tests capturing that behavior.

**Test Cases**:
1. **extractTime() Preservation**: Verify `extractTime("2026-09-05 12:30:01")` returns "12:30:01" on both unfixed and fixed code
2. **formatNotificationMessage() Preservation**: Verify message formatting with valid data produces identical output
3. **scheduleNotification() Preservation**: Verify notification scheduling logic (delay calculation, setTimeout) works identically when given valid timestamps
4. **syncSchedule() Workflow Preservation**: Verify the full workflow (fetch CRM data, parse date, store in DB, schedule) executes identically except for the date parsing step

**Note**: Since the current CRM API only returns "YYYY-MM-DD HH:MM:SS" format, there may be no valid inputs in the preservation set (all production inputs are buggy). However, we still test preservation of:
- Functions that consume the parsed Date object (they should work better after the fix)
- Functions that don't use `parseLessonDate()` at all (they should be completely unchanged)

### Unit Tests

- Test `parseLessonDate()` with various ISO format date strings (different years, months, days, times)
- Test edge cases (year boundaries, midnight, 23:59, leap years, month boundaries)
- Test that invalid inputs still produce Invalid Date (e.g., "invalid-date", empty string, null)
- Test that `extractTime()` continues to work correctly with ISO format
- Test that `formatNotificationMessage()` produces correct output with parsed dates

### Property-Based Tests

- Generate random valid ISO format date strings and verify `parseLessonDate()` returns valid Date objects with correct components
- Generate random lesson data and verify `formatNotificationMessage()` produces valid messages
- Generate random timestamps and verify `scheduleNotification()` calculates delays correctly
- Test that all non-parsing functions produce identical output before and after the fix

### Integration Tests

- Test full notification workflow with real CRM API response format
- Test `syncSchedule()` end-to-end with multiple users and various lesson dates
- Test notification scheduling and sending with actual setTimeout execution
- Test that notifications are sent at the correct time (24 hours before lesson)
