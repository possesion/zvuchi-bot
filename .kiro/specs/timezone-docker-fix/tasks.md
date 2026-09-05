# Implementation Plan - Timezone Docker Fix

## Overview

Исправление некорректной обработки московского времени в Docker-контейнере с UTC timezone. Функция `parseLessonDate()` интерпретирует даты из CRM (всегда в MSK) как локальное время сервера, что приводит к смещению уведомлений на 3 часа в production.

**Решение**: Явная конвертация MSK → UTC через математические операции без внешних библиотек.

---

## Tasks

- [x] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - MSK Date Parsing in UTC Environment
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate the bug exists
  - **Scoped PBT Approach**: For deterministic bugs, scope the property to the concrete failing case(s) to ensure reproducibility
  - Test that `parseLessonDate("2026-09-05 12:30:01")` in UTC environment creates Date object with correct MSK interpretation (UTC+3 offset applied)
  - Test concrete case: CRM date `"2026-09-05 12:30:01"` should produce UTC timestamp `1788514200000` (2026-09-05T09:30:00.000Z), not `1788525000000` (2026-09-05T12:30:00.000Z)
  - Test notification scheduling: for lesson at `"2026-09-05 12:30:01"` MSK, notification should be scheduled at `1788427800000` (2026-09-04T09:30:00.000Z)
  - Test midnight boundary: `"2026-09-05 00:30:01"` MSK should become `1788489000000` (2026-09-04T21:30:00.000Z)
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS with +3 hour offset (10800000ms difference) - this proves the bug exists
  - Document counterexamples found: timestamp mismatch, incorrect notification scheduling time
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3_

- [~] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Non-Buggy Date Parsing Behavior
  - **IMPORTANT**: Follow observation-first methodology
  - Observe behavior on UNFIXED code for valid date strings in format "YYYY-MM-DD HH:MM:SS"
  - Observe behavior on UNFIXED code for invalid date strings (empty, malformed, non-existent dates)
  - Write property-based tests capturing observed behavior patterns:
    - For all valid date format strings, parsing should succeed and return valid Date object
    - For all invalid date format strings, parsing should return Invalid Date (isNaN)
    - For any valid date, the resulting Date object should have valid year, month, day, hours, minutes
    - For dates processed in MSK environment locally, behavior should remain identical
  - Property-based testing generates many test cases for stronger guarantees
  - Test cases:
    - Valid dates: `"2026-12-31 23:59:59"`, `"2026-01-01 00:00:00"`, `"2026-06-15 14:30:00"`
    - Invalid dates: empty string, `"invalid"`, `"2026-13-01 12:00:00"`, `"2026-02-30 10:00:00"`
    - Edge cases: leap year dates, month boundaries, midnight crossings
  - Verify helper functions remain unchanged: `extractTime()`, `formatNotificationMessage()`
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.9_

- [ ] 3. Fix for timezone handling in Docker environment

  - [~] 3.1 Implement MSK to UTC conversion in parseLessonDate()
    - Update `src/notifications.js` function `parseLessonDate(dateString)`
    - Change Date object creation from local timezone to explicit UTC with MSK offset
    - **Implementation steps**:
      1. Keep existing string parsing logic (year, month, day, hours, minutes extraction)
      2. Replace `new Date(year, month - 1, day, hours, minutes)` with UTC approach:
         ```javascript
         // Create UTC timestamp treating components as MSK
         const utcTimestamp = Date.UTC(year, month - 1, day, hours, minutes);
         // Subtract 3 hours (MSK offset) to get correct UTC time
         const mskOffset = 3 * 60 * 60 * 1000; // 10800000 ms
         const correctedTimestamp = utcTimestamp - mskOffset;
         // Create Date object from corrected timestamp
         return new Date(correctedTimestamp);
         ```
      3. Update function comment to document MSK → UTC conversion
    - **Mathematical basis**: MSK = UTC+3, so to convert MSK to UTC we subtract 3 hours
    - _Bug_Condition: `isBugCondition(environment, dateString)` where `environment.serverTimezone == "UTC"` AND `dateString.source == "AlfaCRM_API"` AND `dateString.implicitTimezone == "MSK"`_
    - _Expected_Behavior: For any CRM date string in format "YYYY-MM-DD HH:MM:SS", create Date object with correct UTC timestamp (MSK time - 3 hours). Example: "2026-09-05 12:30:01" MSK → 1788514200000 (2026-09-05T09:30:00.000Z)_
    - _Preservation: Valid date strings continue to parse successfully, invalid strings continue to return Invalid Date, helper functions (extractTime, formatNotificationMessage) continue to work identically_
    - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 3.1, 3.2, 3.3_

  - [~] 3.2 Fix cron schedule for MSK execution in UTC environment
    - Update `index.js` cron configuration
    - Change cron expression from `'0 0 * * *'` to `'0 21 * * *'` (execute at 21:00 UTC = 00:00 MSK next day)
    - Remove `{ timezone: 'Europe/Moscow' }` parameter (doesn't work reliably in Docker)
    - Update comment explaining that 21:00 UTC equals midnight MSK of the next day
    - **Rationale**: UTC-based cron is reliable across all environments, no dependency on timezone data
    - _Bug_Condition: Docker container without Europe/Moscow timezone data, cron configured with timezone parameter_
    - _Expected_Behavior: Cron task executes at 00:00 MSK (21:00 UTC previous day) reliably every day_
    - _Preservation: Cron callback function continues to be called with same parameters, error handling preserved_
    - _Requirements: 1.4, 1.5, 2.4, 2.5, 3.6, 3.7_

  - [~] 3.3 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - MSK Date Parsing After Fix
    - **IMPORTANT**: Re-run the SAME test from task 1 - do NOT write a new test
    - The test from task 1 encodes the expected behavior
    - When this test passes, it confirms the expected behavior is satisfied
    - Run bug condition exploration test from step 1
    - Verify timestamps are now correct:
      - `"2026-09-05 12:30:01"` → `1788514200000` (2026-09-05T09:30:00.000Z) ✓
      - Notification scheduled at correct time: `1788427800000` (2026-09-04T09:30:00.000Z) ✓
      - Midnight boundary handled correctly: `"2026-09-05 00:30:01"` → `1788489000000` ✓
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed, no more +3 hour offset)
    - _Requirements: 2.1, 2.2, 2.3_

  - [~] 3.4 Verify preservation tests still pass
    - **Property 2: Preservation** - Non-Buggy Behavior After Fix
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - Run preservation property tests from step 2
    - Confirm all scenarios still work:
      - Valid date strings parse successfully ✓
      - Invalid date strings return Invalid Date ✓
      - Helper functions work identically ✓
      - No regressions in edge cases ✓
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.9_

- [~] 4. Checkpoint - Ensure all tests pass
  - Run all existing test files:
    - `src/parseLessonDate.bugcondition.test.js`
    - `src/parseLessonDate.preservation.test.js`
    - Any other related test files
  - Verify all tests pass without modification
  - Verify no new dependencies were added (check package.json)
  - Verify solution works in both local MSK and Docker UTC environments
  - Ensure healthcheck endpoint `/users` still returns correct format
  - If any issues arise, discuss with user before proceeding

## Notes

- **No external dependencies**: Solution uses only built-in Date.UTC() and mathematical operations
- **No environment variables**: No need to set TZ in Docker or modify docker-compose.yml
- **Backwards compatible**: Works in both UTC Docker and local MSK environments
- **Test-driven approach**: Write and fail tests first, then implement fix, then verify tests pass
