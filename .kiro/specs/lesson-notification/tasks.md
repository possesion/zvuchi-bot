# Implementation Plan: Lesson Notification Feature

## Overview

This implementation plan breaks down the lesson notification feature into discrete coding tasks. The feature adds automated lesson reminders for subscribed students, with intelligent timing (Sunday morning for Monday lessons, 24 hours in advance for other weekdays). The implementation extends the existing bot architecture with a new notification module, database schema extension, and command handlers, while preserving all existing functionality.

## Tasks

- [ ] 1. Extend database schema and add notification subscription functions
  - Add `notify` column to users table with migration logic
  - Implement `setNotify(userId, notify)` function
  - Implement `getNotify(userId)` function
  - Implement `getSubscribedUsers()` function
  - Implement `initializeNotifyColumn()` migration function
  - _Requirements: 1.5, 8.1, 8.2, 8.3, 8.4_

- [ ]* 1.1 Write unit tests for database notification functions
  - Test `setNotify()` sets notify field to true/false correctly
  - Test `getNotify()` retrieves correct subscription status
  - Test `getSubscribedUsers()` returns only users with notify=true
  - Test `initializeNotifyColumn()` handles existing column gracefully
  - _Requirements: 1.5, 8.1, 8.2, 8.3, 8.4_

- [ ] 2. Add subscription command handlers
  - [ ] 2.1 Extend `handleText()` in src/handlers.js to handle /notify command
    - Check if user has phone number before allowing subscription
    - Call `setNotify(userId, true)` when user subscribes
    - Send confirmation message to user
    - _Requirements: 1.1, 1.2_

  - [ ] 2.2 Add /unsubscribe command handler to `handleText()`
    - Call `setNotify(userId, false)` when user unsubscribes
    - Send confirmation message to user
    - _Requirements: 1.3, 1.4_

  - [ ]* 2.3 Write unit tests for subscription commands
    - Test /notify requires phone number
    - Test /notify sets notify=true and sends confirmation
    - Test /unsubscribe sets notify=false and sends confirmation
    - Test existing commands remain unchanged
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 10.1, 10.2, 10.3, 10.4_

- [ ] 3. Checkpoint - Verify subscription management works
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 4. Implement notification module core functions
  - [ ] 4.1 Create src/notifications.js and implement date parsing
    - Implement `parseLessonDate(dateString)` to parse DD.MM.YYYY HH:MM format
    - Implement `extractTime(dateString)` to extract HH:MM from lesson date
    - _Requirements: 5.4_

  - [ ]* 4.2 Write property test for date parsing
    - **Property 6: Tomorrow Lesson Detection**
    - **Validates: Requirements 4.1, 4.2, 4.3**
    - Generate random lesson dates within next 7 days
    - Verify shouldSendNotification returns true only for lessons ~24 hours away
    - Run minimum 100 iterations
    - _Requirements: 4.1, 4.2, 4.3_

  - [ ] 4.3 Implement notification timing logic
    - Implement `shouldSendNotification(lessonDate)` to check if notification should be sent
    - Handle Monday lesson special case (notification on Sunday)
    - Handle Tuesday-Sunday lessons (24-hour advance notification)
    - _Requirements: 3.1, 3.2, 3.3, 4.1, 4.2, 4.3_

  - [ ]* 4.4 Write property test for notification timing calculation
    - **Property 2: Notification Timing Calculation**
    - **Validates: Requirements 3.1, 3.2, 3.3, 4.1, 4.2, 4.3**
    - Generate random lesson dates across all weekdays
    - Verify notification time is Sunday midnight for Monday lessons
    - Verify notification time is 24 hours before for other weekdays
    - Run minimum 100 iterations
    - _Requirements: 3.1, 3.2, 3.3, 4.1, 4.2, 4.3_

  - [ ] 4.5 Implement message formatting functions
    - Implement `formatNotificationMessage(clientData)` to create personalized messages
    - Extract client name from CRM data
    - Format message as "Привет, <Имя клиента>, завтра в <время занятия> у тебя урок по вокалу."
    - _Requirements: 5.1, 5.2, 5.3_

  - [ ]* 4.6 Write property test for message format preservation
    - **Property 3: Message Format Preservation**
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4**
    - Generate random client names and lesson dates
    - Verify formatted message contains client name
    - Verify formatted message contains lesson time in HH:MM format
    - Run minimum 100 iterations
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

- [ ] 5. Implement CRM error handling with retry logic
  - [ ] 5.1 Implement `getClientDataWithRetry(phone)` function
    - Wrap `api.getClientData(phone)` with retry logic
    - Retry once after 1-second delay on failure
    - Throw error after second failure
    - _Requirements: 7.1, 7.3, 7.4_

  - [ ]* 5.2 Write property test for error handling with retry
    - **Property 4: Error Handling with Retry**
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4**
    - Simulate CRM failures (network errors, HTTP errors)
    - Verify retry happens exactly once
    - Verify error message sent after two failures
    - Run minimum 100 iterations
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

- [ ] 6. Checkpoint - Verify notification logic functions work
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 7. Implement main notification orchestration
  - [ ] 7.1 Implement `checkAndSendNotifications(bot)` function
    - Retrieve all subscribed users from database
    - For each user, get phone number and CRM client data
    - Calculate notification timing and send messages
    - Handle missing lesson data (send "Урок не запланирован")
    - Handle CRM errors (send error message after retry)
    - Continue processing other users if one fails
    - _Requirements: 2.1, 2.2, 2.3, 6.1, 6.2, 6.3, 6.4, 7.2, 11.1, 11.3, 11.4_

  - [ ]* 7.2 Write property test for notification delivery isolation
    - **Property 5: Notification Delivery Isolation**
    - **Validates: Requirements 11.1, 11.3, 11.4**
    - Generate random set of subscribed users
    - Simulate message delivery failures for some users
    - Verify all users receive exactly one notification attempt
    - Verify failures don't stop processing of remaining users
    - Run minimum 100 iterations
    - _Requirements: 11.1, 11.3, 11.4_

  - [ ] 7.3 Implement `runDailyCheck(bot)` export function
    - Export function for cron invocation
    - Call `checkAndSendNotifications(bot)`
    - _Requirements: 2.4, 9.1, 9.2_

- [ ] 8. Create cron entry point script
  - [ ] 8.1 Create runNotifications.js script
    - Load environment variables
    - Create Telegram bot instance with polling disabled
    - Call `runDailyCheck(bot)` from notifications module
    - Handle success/error exit codes
    - _Requirements: 2.4, 9.1, 9.2_

  - [ ]* 8.2 Write integration test for notification flow
    - Test complete flow from subscription to notification delivery
    - Mock CRM API responses
    - Mock Telegram bot sendMessage
    - Verify notifications sent at correct times
    - Verify error handling works end-to-end
    - _Requirements: 2.1, 2.2, 2.3, 5.1, 5.2, 5.3, 5.4, 6.1, 6.2, 6.3, 6.4, 7.1, 7.2_

- [ ] 9. Import and initialize notification module in main application
  - Import notification functions in index.js or appropriate initialization file
  - Call `initializeNotifyColumn()` during database setup
  - Import database notification functions in src/handlers.js
  - _Requirements: 8.1, 9.3, 9.4, 9.5_

- [ ] 10. Final checkpoint - End-to-end verification
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties with minimum 100 iterations
- Unit tests validate specific examples and edge cases
- The design uses JavaScript (CommonJS), so all implementation uses JavaScript
- No new npm packages are required (uses existing dependencies)
- Database migration handles existing tables gracefully
- Error handling ensures one user's failure doesn't affect others
- All existing bot functionality remains unchanged (Requirements 10.1-10.5)

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["1.1", "2.1", "2.2"] },
    { "id": 2, "tasks": ["2.3", "4.1"] },
    { "id": 3, "tasks": ["4.2", "4.3", "4.5"] },
    { "id": 4, "tasks": ["4.4", "4.6", "5.1"] },
    { "id": 5, "tasks": ["5.2", "7.1"] },
    { "id": 6, "tasks": ["7.2", "7.3", "8.1"] },
    { "id": 7, "tasks": ["8.2", "9"] }
  ]
}
```
