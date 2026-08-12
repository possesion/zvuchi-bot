# Requirements Document

## Introduction

This document specifies requirements for the Lesson Notification feature in the Zvuchi Bot. The feature enables students to subscribe to automatic notifications about their upcoming vocal lessons. The system integrates with the AlfaCRM system to retrieve lesson schedules and sends proactive notifications to subscribed users at appropriate times.

## Glossary

- **Zvuchi_Bot**: The Telegram bot application that provides lesson information and notifications to students
- **CRM_System**: The AlfaCRM v2 API hosted at zvuchi.s20.online that stores customer and lesson data
- **Notification_Module**: The src/notifications.js module responsible for checking lesson schedules and sending notifications
- **User**: A student interacting with the Zvuchi Bot through Telegram
- **Subscribed_User**: A user who has enabled lesson notifications via the /notify command
- **Lesson_Date**: The scheduled date and time of a lesson in format DD.MM.YYYY HH:MM
- **Moscow_Time**: The timezone used for all notification scheduling (UTC+3)
- **Notification_Window**: The time period before a lesson when notification should be sent (24 hours for weekday lessons, Sunday 10:00 for Monday lessons)
- **CRM_Client_Data**: Customer data retrieved from CRM including next_lesson_date and customer name fields

## Requirements

### Requirement 1: Subscription Management

**User Story:** As a student, I want to subscribe to lesson notifications, so that I receive automatic reminders about my upcoming vocal lessons

#### Acceptance Criteria

1. WHEN a User sends the /notify command, THE Zvuchi_Bot SHALL set the notify field to TRUE for that User in the database
2. WHEN a User sends the /notify command, THE Zvuchi_Bot SHALL send a confirmation message to the User
3. WHEN a User sends the /unsubscribe command, THE Zvuchi_Bot SHALL set the notify field to FALSE for that User in the database
4. WHEN a User sends the /unsubscribe command, THE Zvuchi_Bot SHALL send a confirmation message to the User
5. THE Zvuchi_Bot SHALL store the notify field as a BOOLEAN type in the users table

### Requirement 2: Daily Notification Check

**User Story:** As a subscribed student, I want the system to check my lesson schedule daily, so that I receive timely notifications about upcoming lessons

#### Acceptance Criteria

1. THE Notification_Module SHALL execute a notification check daily at 00:00 Moscow_Time
2. WHEN the notification check runs, THE Notification_Module SHALL retrieve all Subscribed_Users from the database
3. WHEN the notification check runs, THE Notification_Module SHALL query the CRM_System for each Subscribed_User using their phone number
4. THE Notification_Module SHALL be invoked by an external cron scheduling system

### Requirement 3: Monday Lesson Notification Timing

**User Story:** As a subscribed student with Monday lessons, I want to receive notifications on Monday morning, so that I have advance notice on the weekend

#### Acceptance Criteria

1. WHEN a Subscribed_User has a lesson scheduled for Monday, THE Notification_Module SHALL send the notification on Monday at 10:00 Moscow_Time
2. WHEN calculating notification time for Monday lessons, THE Notification_Module SHALL identify lessons where Lesson_Date day is Monday


### Requirement 4: Weekday Lesson Notification Timing

**User Story:** As a subscribed student with lessons on Tuesday through Sunday, I want to receive notifications 24 hours before my lesson, so that I have one day's notice

#### Acceptance Criteria

1. WHEN a Subscribed_User has a lesson scheduled for Tuesday through Sunday, THE Notification_Module SHALL send the notification 24 hours before the Lesson_Date
2. WHEN calculating the 24-hour notification window, THE Notification_Module SHALL use Moscow_Time for all time calculations
3. WHEN the notification check determines a lesson is within the Notification_Window, THE Notification_Module SHALL send the notification during the same check cycle

### Requirement 5: Notification Message Content

**User Story:** As a subscribed student, I want to receive personalized notification messages, so that I know when my vocal lesson is scheduled

#### Acceptance Criteria

1. WHEN sending a notification, THE Notification_Module SHALL format the message as "Привет, <Имя клиента>, завтра в <время занятия> у тебя урок по вокалу."
2. WHEN formatting the notification message, THE Notification_Module SHALL extract the client name from CRM_Client_Data
3. WHEN formatting the notification message, THE Notification_Module SHALL extract the lesson time (HH:MM) from the Lesson_Date field
4. WHEN the CRM_Client_Data contains a Lesson_Date, THE Notification_Module SHALL parse the date using the format DD.MM.YYYY HH:MM

### Requirement 6: Missing Lesson Notification

**User Story:** As a subscribed student without scheduled lessons, I want to be notified that no lesson is planned, so that I am aware of my lesson status

#### Acceptance Criteria

1. WHEN a Subscribed_User has no scheduled lesson in CRM_Client_Data, THE Notification_Module SHALL send the message "Урок не запланирован"
2. WHEN the CRM_Client_Data next_lesson_date field is null, THE Notification_Module SHALL identify this as a missing lesson
3. WHEN the CRM_Client_Data next_lesson_date field is empty, THE Notification_Module SHALL identify this as a missing lesson
4. WHEN sending a missing lesson notification, THE Notification_Module SHALL send it during the daily notification check

### Requirement 7: CRM Communication Error Handling

**User Story:** As a subscribed student, I want to receive an error message if the system cannot retrieve my lesson data, so that I know the notification system encountered a problem

#### Acceptance Criteria

1. WHEN the CRM_System request fails, THE Notification_Module SHALL retry the request one time
2. IF the CRM_System request fails after one retry, THEN THE Notification_Module SHALL send the message "Не могу получить данные об уроке в CRM" to the User
3. WHEN a CRM_System request fails with a network error, THE Notification_Module SHALL count this as a failed request for retry logic
4. WHEN a CRM_System request fails with an HTTP error status, THE Notification_Module SHALL count this as a failed request for retry logic

### Requirement 8: Database Schema Extension

**User Story:** As the system, I need to store notification preferences, so that I can determine which users should receive notifications

#### Acceptance Criteria

1. THE Zvuchi_Bot SHALL add a notify field to the users table
2. THE notify field SHALL be of type BOOLEAN
3. WHEN a new user is created, THE notify field SHALL default to FALSE
4. THE users table SHALL maintain existing fields user_id, phone_number, and created_at

### Requirement 9: Module Architecture

**User Story:** As a developer, I want notification logic separated into its own module, so that the codebase remains maintainable and organized

#### Acceptance Criteria

1. THE Notification_Module SHALL be implemented in a file at path src/notifications.js
2. THE Notification_Module SHALL expose functions for external cron invocation
3. THE Notification_Module SHALL import database functions from src/database.js
4. THE Notification_Module SHALL import CRM API functions from src/api.js
5. THE Notification_Module SHALL import the Telegram bot instance or bot functions as needed for sending messages

### Requirement 10: Existing Functionality Preservation

**User Story:** As a user, I want existing bot commands to continue working unchanged, so that my current workflow is not disrupted

#### Acceptance Criteria

1. THE Zvuchi_Bot SHALL maintain the /start command functionality without modification
2. THE Zvuchi_Bot SHALL maintain the /lessonstotal command functionality without modification
3. THE Zvuchi_Bot SHALL maintain the /nextlesson command functionality without modification
4. THE Zvuchi_Bot SHALL maintain the phone number registration flow without modification
5. THE Zvuchi_Bot SHALL add the notification feature without installing new npm packages

### Requirement 11: Notification Delivery

**User Story:** As a subscribed student, I want notifications delivered to my Telegram chat, so that I receive them where I interact with the bot

#### Acceptance Criteria

1. WHEN sending a notification, THE Notification_Module SHALL send the message to the User's Telegram chat_id
2. WHEN retrieving the User's chat_id, THE Notification_Module SHALL query the database using the user_id
3. IF a notification message fails to send, THEN THE Notification_Module SHALL log the error and continue processing other Subscribed_Users
4. THE Notification_Module SHALL send each notification as an individual message to each Subscribed_User
