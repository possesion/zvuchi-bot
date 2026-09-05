# Implementation Plan

- [x] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - ISO Format Date Parsing Failure
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate the bug exists
  - **Scoped PBT Approach**: Scope the property to concrete failing cases with ISO format dates "YYYY-MM-DD HH:MM:SS"
  - Test that `parseLessonDate()` returns Invalid Date (NaN timestamp) for inputs matching pattern "YYYY-MM-DD HH:MM:SS"
  - The test assertions should verify that:
    - Input format: "YYYY-MM-DD HH:MM:SS" (e.g., "2026-09-05 12:30:01", "2026-09-07 18:30:01")
    - Result: `parseLessonDate(input).getTime()` returns `NaN`
    - This confirms the current parser cannot handle dash-separated ISO format
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS (this is correct - it proves the bug exists)
  - Document counterexamples found to understand root cause (split by '.' fails on dash-separated format)
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 1.1, 1.2, 1.3_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Downstream Notification Workflow Preservation
  - **IMPORTANT**: Follow observation-first methodology
  - Observe behavior on UNFIXED code for downstream functions that work correctly:
    - `extractTime()` correctly extracts "HH:MM:SS" from ISO format time portion
    - `formatNotificationMessage()` formats messages correctly when given valid data
    - `scheduleNotification()` calculates delay and sets timeout correctly when given valid timestamp
    - `syncSchedule()` workflow processes users correctly (parsing dates, storing in DB, scheduling)
    - Notification sending verifies records, marks sent atomically, sends Telegram messages
    - Database schema stores schedules with correct fields (user_id, next_lesson_date, scheduled_at, name, paid_count, sent)
  - Write property-based tests capturing observed behavior patterns
  - Property-based testing generates many test cases for stronger guarantees
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [x] 3. Fix parseLessonDate() to handle ISO format dates

  - [x] 3.1 Implement the fix in src/notifications.js
    - Modify `parseLessonDate()` to detect and parse "YYYY-MM-DD HH:MM:SS" format
    - Split date string by '-' for dash-separated format instead of '.'
    - Extract year, month, day in correct order from ISO format (YYYY-MM-DD)
    - Parse time component by splitting on space and then ':'
    - Ignore seconds component, use only hours and minutes
    - Construct Date object with correctly parsed components: `new Date(year, month - 1, day, hours, minutes)`
    - Ensure function returns valid Date object with valid timestamp (not NaN)
    - _Bug_Condition: isBugCondition(input) where input matches "YYYY-MM-DD HH:MM:SS"_
    - _Expected_Behavior: result is valid Date object, result.getTime() returns valid timestamp, extracted components match input_
    - _Preservation: extractTime(), formatNotificationMessage(), scheduleNotification(), syncSchedule(), notification sending, and database schema remain unchanged_
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [x] 3.2 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - ISO Format Date Parsing Success
    - **IMPORTANT**: Re-run the SAME test from task 1 - do NOT write a new test
    - The test from task 1 encodes the expected behavior
    - When this test passes, it confirms the expected behavior is satisfied
    - Run bug condition exploration test from step 1
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed)
    - Verify that `parseLessonDate("2026-09-05 12:30:01")` returns valid Date with correct timestamp
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_

  - [x] 3.3 Verify preservation tests still pass
    - **Property 2: Preservation** - Downstream Notification Workflow Preservation
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - Run preservation property tests from step 2
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - Confirm all preservation tests still pass after fix (no regressions in downstream functions)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [x] 4. Checkpoint - Ensure all tests pass
  - Run all tests to verify bug is fixed and no regressions introduced
  - Verify that notifications are now scheduled correctly with valid timestamps
  - Check logs to confirm `scheduledAt` shows numeric timestamps instead of `null`
  - Ask the user if questions arise
