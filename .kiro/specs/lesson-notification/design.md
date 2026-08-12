# Design Document: Lesson Notification Feature

## Overview

This design document specifies the architecture for adding automated lesson notifications to the Zvuchi Bot. The feature enables students to subscribe to automatic reminders about upcoming vocal lessons, with intelligent timing based on the lesson schedule (Sunday morning for Monday lessons, 24 hours in advance for other weekdays).

The design extends the existing bot architecture by adding a new notification module (`src/notifications.js`), extending the database schema with a subscription flag, adding new command handlers, and providing an entry point for external cron scheduling.

## Architecture

### High-Level Components

```
┌─────────────────────────────────────────────────────────────┐
│                    External Cron System                      │
│                  (daily at 00:00 Moscow time)               │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ├─ invokes
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                  Notification Module                         │
│                  (src/notifications.js)                      │
│                                                              │
│  • checkAndSendNotifications()                              │
│  • calculateNotificationTime(lessonDate)                    │
│  • formatNotificationMessage(clientData)                    │
│  • sendNotificationToUser(userId, message)                  │
└──────┬───────────────────┬────────────────────┬─────────────┘
       │                   │                    │
       │ uses              │ uses               │ uses
       ▼                   ▼                    ▼
┌─────────────┐    ┌──────────────┐    ┌──────────────────┐
│  Database   │    │   API        │    │  Telegram Bot    │
│  Module     │    │   Module     │    │  Instance        │
│             │    │              │    │                  │
│ • getPhone  │    │ • getCRM     │    │ • sendMessage    │
│ • getNotify │    │   ClientData │    │                  │
│ • setNotify │    │              │    │                  │
└─────────────┘    └──────────────┘    └──────────────────┘
       ▲                                        ▲
       │                                        │
       │ uses                                   │ uses
       │                                        │
┌──────┴────────────────────────────────────────┴─────────────┐
│                    Handlers Module                           │
│                  (src/handlers.js)                          │
│                                                              │
│  • handleText(bot) - extended with /notify, /unsubscribe    │
│  • handleContact(bot) - unchanged                           │
└──────────────────────────────────────────────────────────────┘
```

### Module Responsibilities

**src/notifications.js** (new module)
- Orchestrates the daily notification check process
- Retrieves all subscribed users from the database
- Queries CRM for each user's lesson schedule
- Calculates appropriate notification timing
- Formats and sends notification messages
- Handles CRM errors with retry logic

**src/database.js** (extended)
- Adds functions to manage notification subscription state
- Maintains existing phone number storage functionality
- Executes database schema migration for notify field

**src/handlers.js** (extended)
- Adds command handlers for /notify and /unsubscribe
- Preserves all existing command functionality

**src/api.js** (unchanged)
- Continues to provide CRM data access
- Existing caching and retry logic remains intact

## Data Model

### Database Schema Extension

The existing `users` table is extended with a notification subscription field:

```sql
CREATE TABLE IF NOT EXISTS users (
  user_id INTEGER PRIMARY KEY,
  phone_number TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  notify BOOLEAN DEFAULT 0  -- NEW FIELD
)
```

**Migration Strategy:**
- Use `ALTER TABLE users ADD COLUMN notify BOOLEAN DEFAULT 0` if table exists
- The migration runs on module initialization

### Data Flow

**Subscription Flow:**
```
User sends /notify
    → handleText processes command
    → database.setNotify(userId, true)
    → Confirmation sent to user
```

**Daily Notification Flow:**
```
Cron triggers at 00:00 Moscow time
    → notifications.checkAndSendNotifications()
    → database.getSubscribedUsers()
    → For each subscribed user:
        → database.getPhone(userId)
        → api.getClientData(phone)
        → calculateNotificationTime(lessonDate)
        → If within notification window:
            → formatNotificationMessage(clientData)
            → bot.sendMessage(userId, message)
        → Error handling with retry on CRM failure
```

## Core Functions

### Notification Module (src/notifications.js)

#### checkAndSendNotifications()

Entry point for cron invocation. Orchestrates the entire notification check cycle.

```javascript
async function checkAndSendNotifications(bot) {
  const subscribedUsers = getSubscribedUsers();
  
  for (const user of subscribedUsers) {
    try {
      const phone = getPhone(user.user_id);
      if (!phone) continue;
      
      const clientData = await getClientDataWithRetry(phone);
      
      if (!clientData || !clientData.next_lesson_date) {
        await bot.sendMessage(user.user_id, 'Урок не запланирован');
        continue;
      }
      
      const lessonDate = parseLessonDate(clientData.next_lesson_date);
      const shouldNotify = shouldSendNotification(lessonDate);
      
      if (shouldNotify) {
        const message = formatNotificationMessage(clientData);
        await bot.sendMessage(user.user_id, message);
      }
    } catch (error) {
      console.error(`Error processing user ${user.user_id}:`, error);
      // Continue processing other users
    }
  }
}
```

#### calculateNotificationTime(lessonDate)

Determines when notification should be sent based on lesson day.

**Logic:**
- Monday lessons: Notification sent on Sunday at 10:00 Moscow time
- Tuesday-Sunday lessons: Notification sent 24 hours before lesson time

**Implementation:**
```javascript
function shouldSendNotification(lessonDate) {
  const now = new Date(); // Assumes system time is Moscow time
  const lessonDay = lessonDate.getDay(); // 0 = Sunday, 1 = Monday, etc.
  
  if (lessonDay === 1) { // Monday lesson
    // Check if today is Sunday and current time is 10:00
    const isSunday = now.getDay() === 0;
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    
    // Send notification if it's Sunday morning at 10:00 (within the check window)
    return isSunday && currentHour === 10 && currentMinute === 0;
  } else { // Tuesday-Sunday lesson
    // Calculate 24 hours before lesson
    const notificationTime = new Date(lessonDate.getTime() - 24 * 60 * 60 * 1000);
    
    // Check if current time matches notification time (within check window)
    const timeDiff = Math.abs(now.getTime() - notificationTime.getTime());
    const oneHour = 60 * 60 * 1000;
    
    return timeDiff < oneHour; // Within 1-hour window
  }
}
```

#### formatNotificationMessage(clientData)

Creates personalized notification message.

**Input:** CRM client data object
```javascript
{
  name: "Иван",
  next_lesson_date: "25.12.2024 15:30"
}
```

**Output:** Formatted string
```
"Привет, Иван, завтра в 15:30 у тебя урок по вокалу."
```

**Implementation:**
```javascript
function formatNotificationMessage(clientData) {
  const lessonTime = extractTime(clientData.next_lesson_date); // "15:30"
  const clientName = clientData.name || 'студент';
  
  return `Привет, ${clientName}, завтра в ${lessonTime} у тебя урок по вокалу.`;
}

function extractTime(dateString) {
  // Parse "DD.MM.YYYY HH:MM" format
  const parts = dateString.split(' ');
  return parts[1]; // Returns "HH:MM"
}
```

#### getClientDataWithRetry(phone)

Wraps CRM API call with retry logic.

**Retry Strategy:**
- First attempt: Call `api.getClientData(phone)`
- On failure: Wait 1 second, retry once
- On second failure: Throw error (caught by caller)

**Implementation:**
```javascript
async function getClientDataWithRetry(phone, retries = 1) {
  try {
    return await getClientData(phone);
  } catch (error) {
    if (retries > 0) {
      console.log(`Retrying CRM request for ${phone}...`);
      await sleep(1000);
      return await getClientDataWithRetry(phone, retries - 1);
    }
    throw error;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

### Database Module Extension (src/database.js)

#### setNotify(userId, notify)

Sets notification subscription status for a user.

```javascript
function setNotify(userId, notify) {
  const stmt = db.prepare('UPDATE users SET notify = ? WHERE user_id = ?');
  stmt.run(notify ? 1 : 0, userId);
}
```

#### getNotify(userId)

Retrieves notification subscription status.

```javascript
function getNotify(userId) {
  const stmt = db.prepare('SELECT notify FROM users WHERE user_id = ?');
  const row = stmt.get(userId);
  return row ? Boolean(row.notify) : false;
}
```

#### getSubscribedUsers()

Retrieves all users with notify=true.

```javascript
function getSubscribedUsers() {
  const stmt = db.prepare('SELECT user_id FROM users WHERE notify = 1');
  return stmt.all();
}
```

#### initializeNotifyColumn()

Migrates database schema if notify column doesn't exist.

```javascript
function initializeNotifyColumn() {
  try {
    db.exec('ALTER TABLE users ADD COLUMN notify BOOLEAN DEFAULT 0');
    console.log('Added notify column to users table');
  } catch (error) {
    if (error.message.includes('duplicate column name')) {
      console.log('notify column already exists');
    } else {
      throw error;
    }
  }
}
```

### Handlers Module Extension (src/handlers.js)

Extend `handleText()` to support new commands:

```javascript
function handleText(bot) {
  return async (msg) => {
    const userId = msg.from.id;
    const text = msg.text;
    const userPhone = getPhone(userId);

    if (text === '/start') {
      return bot.sendMessage(msg.chat.id, 'Вы запустили бота!');
    }

    // NEW: Subscription commands don't require phone number
    if (text === '/notify') {
      if (!userPhone) {
        return bot.sendMessage(msg.chat.id, 'Сначала поделитесь номером телефона');
      }
      setNotify(userId, true);
      return bot.sendMessage(msg.chat.id, 'Уведомления включены! Вы будете получать напоминания о занятиях.');
    }

    if (text === '/unsubscribe') {
      setNotify(userId, false);
      return bot.sendMessage(msg.chat.id, 'Уведомления отключены.');
    }

    // Existing phone number check for CRM commands
    if (!userPhone) {
      return bot.sendMessage(msg.chat.id, 'Для работы с CRM нужен ваш номер телефона', {
        reply_markup: {
          keyboard: [[{ text: '📱 Отправить номер телефона', request_contact: true }]],
          resize_keyboard: true,
          one_time_keyboard: true
        }
      });
    }

    // Existing CRM command logic
    if (text === '/lessonstotal' || text === '/nextlesson') {
      // ... existing implementation unchanged
    }
  };
}
```

## Error Handling

### CRM Communication Failures

**Strategy:** Retry once, then notify user of error

**Implementation:**
- `getClientDataWithRetry()` handles retry logic
- After retry failure, send error message: "Не могу получить данные об уроке в CRM"
- Error logged to console for monitoring
- Other users continue to be processed

### Message Delivery Failures

**Strategy:** Log error and continue processing

**Implementation:**
- Wrap `bot.sendMessage()` in try-catch
- Log failure: `console.error('Failed to send notification to user ${userId}:', error)`
- Continue processing remaining subscribed users

### Missing Lesson Data

**Strategy:** Send informative message to user

**Cases:**
- `clientData` is null/undefined → "Урок не запланирован"
- `clientData.next_lesson_date` is null/empty → "Урок не запланирован"

### Database Query Failures

**Strategy:** Log error and skip user

**Implementation:**
- If `getPhone()` returns null, skip user
- If database query throws error, log and continue to next user

## Date and Time Handling

### Timezone

All calculations use **Moscow Time (UTC+3)**. The system assumes:
- Cron scheduler runs in Moscow timezone
- System clock is set to Moscow time
- Lesson dates from CRM are in Moscow time

### Date Parsing

CRM provides lesson dates in format: `DD.MM.YYYY HH:MM`

**Parsing Implementation:**
```javascript
function parseLessonDate(dateString) {
  // "25.12.2024 15:30" → Date object
  const [datePart, timePart] = dateString.split(' ');
  const [day, month, year] = datePart.split('.').map(Number);
  const [hours, minutes] = timePart.split(':').map(Number);
  
  // JavaScript Date months are 0-indexed
  return new Date(year, month - 1, day, hours, minutes);
}
```

### Notification Window Logic

**Monday Lessons:**
- Trigger: Sunday at 10:00 AM
- Check window: Daily cron runs at 00:00, so we check if current day is Sunday and hour is 10

**Note:** Since cron runs at midnight, the Sunday 10:00 check requires either:
- Running cron multiple times per day, OR
- Storing pending notifications and sending them at appropriate times

**Revised approach for single daily cron:**
- At 00:00 on Sunday, calculate all Monday lessons and mark them for notification
- Send notifications immediately (acceptable compromise) OR
- Require cron to run hourly and check for pending notifications

**For this design, we use the immediate notification approach:**
- If today is Sunday and tomorrow is Monday with a lesson, send notification during the 00:00 check

**Revised shouldSendNotification logic:**
```javascript
function shouldSendNotification(lessonDate) {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  
  // Check if lesson is tomorrow
  const lessonDay = lessonDate.getDate();
  const tomorrowDay = tomorrow.getDate();
  const sameMonth = lessonDate.getMonth() === tomorrow.getMonth();
  const sameYear = lessonDate.getFullYear() === tomorrow.getFullYear();
  
  return lessonDay === tomorrowDay && sameMonth && sameYear;
}
```

This simplified approach sends notifications for any lesson occurring "tomorrow", which satisfies:
- Monday lessons: notification sent Sunday night (at 00:00 check)
- Other weekday lessons: notification sent ~24 hours before

## Integration Points

### External Cron System

**Interface:**
The notification module exports a function that can be invoked by external schedulers:

```javascript
// src/notifications.js
async function runDailyCheck(bot) {
  await checkAndSendNotifications(bot);
}

module.exports = {
  runDailyCheck
};
```

**Cron Configuration (external to bot code):**
```bash
# Run at 00:00 Moscow time daily
0 0 * * * /usr/bin/node /path/to/bot/runNotifications.js
```

**runNotifications.js** (new entry point file):
```javascript
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { runDailyCheck } = require('./src/notifications');

const bot = new TelegramBot(process.env.API_KEY_BOT, {
  polling: false // No polling for cron job
});

runDailyCheck(bot)
  .then(() => {
    console.log('Daily notification check completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Error during notification check:', error);
    process.exit(1);
  });
```

### Telegram Bot API

**Message Sending:**
- Uses existing bot instance from `node-telegram-bot-api`
- Calls `bot.sendMessage(chatId, text)` for notifications
- Chat ID is the user's Telegram user_id (stored in database)

### AlfaCRM API

**Data Retrieval:**
- Uses existing `api.getClientData(phone)` function
- Leverages existing authentication and caching mechanisms
- No changes to API module required

## Testing Strategy

### Unit Tests

Unit tests verify specific examples and edge cases:

**Subscription Commands:**
- Test /notify command sets notify=true for user
- Test /unsubscribe command sets notify=false for user
- Test subscription requires phone number

**Date Parsing:**
- Test parsing valid date string "25.12.2024 15:30"
- Test handling malformed date strings

**Message Formatting:**
- Test message includes client name
- Test message includes lesson time
- Test message handles missing client name

**Error Handling:**
- Test CRM error sends error message to user
- Test missing lesson data sends "Урок не запланирован"

### Property-Based Tests

Property tests verify universal behaviors across many generated inputs. Minimum 100 iterations per test.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Subscription State Transition

*For any* user with a valid phone number, executing the subscribe action should result in their notification preference being set to TRUE, and executing the unsubscribe action should result in their notification preference being set to FALSE.

**Validates: Requirements 1.1, 1.2**

### Property 2: Notification Timing Calculation

*For any* lesson date, the notification timing calculation should produce a notification time that is either Sunday midnight (for Monday lessons occurring in the next 24-36 hours) or 24 hours before the lesson time (for Tuesday-Sunday lessons).

**Validates: Requirements 3.1, 3.2, 3.3, 4.1, 4.2, 4.3**

### Property 3: Message Format Preservation

*For any* valid CRM client data containing a name and lesson date, the formatted notification message should contain both the client name and the lesson time (HH:MM format) extracted from the lesson date.

**Validates: Requirements 5.1, 5.2, 5.3, 5.4**

### Property 4: Error Handling with Retry

*For any* CRM communication error, the notification module should retry the request exactly once, and if both attempts fail, should send the error message "Не могу получить данные об уроке в CRM" to the user.

**Validates: Requirements 7.1, 7.2, 7.3, 7.4**

### Property 5: Notification Delivery Isolation

*For any* set of subscribed users where one or more message deliveries fail, the notification module should continue processing all remaining users without stopping, and each user should receive exactly one notification attempt.

**Validates: Requirements 11.1, 11.3, 11.4**

### Property 6: Tomorrow Lesson Detection

*For any* lesson date that is exactly 24 hours in the future (within a 1-hour tolerance window), the shouldSendNotification function should return true, and for any lesson date outside this window, it should return false.

**Validates: Requirements 4.1, 4.2, 4.3**

## Deployment Considerations

### Database Migration

On first deployment:
1. Run `initializeNotifyColumn()` to add notify field
2. Existing users default to notify=false (no disruption)
3. Users must explicitly opt-in with /notify command

### Cron Setup

System administrator must:
1. Configure cron job on server running the bot
2. Ensure server timezone is set to Moscow time (UTC+3)
3. Configure `runNotifications.js` with correct bot path
4. Set up logging/monitoring for cron job execution

### No New Dependencies

Implementation uses only existing npm packages:
- `node-telegram-bot-api` - for sending notifications
- `better-sqlite3` - for subscription management
- `dotenv` - for environment configuration

## Future Enhancements

Potential improvements beyond initial scope:

1. **Configurable Notification Times:** Allow users to choose preferred notification time
2. **Multiple Notifications:** Send reminders at multiple intervals (e.g., 1 day and 1 hour before)
3. **Lesson Reminders History:** Track which notifications were sent
4. **Custom Messages:** Allow customization of notification text
5. **Time Zone Support:** Support users in different time zones
6. **Notification Preferences:** Allow users to subscribe to specific lesson types only

## Summary

This design extends the Zvuchi Bot with automated lesson notifications through:

- **Minimal code changes:** New module + extensions to existing modules
- **Leveraging existing infrastructure:** Uses current database, API, and bot patterns
- **Clear separation of concerns:** Notification logic isolated in dedicated module
- **Robust error handling:** Retries, graceful degradation, isolated failures
- **Maintainable architecture:** Follows existing codebase patterns and conventions
- **Property-based testing:** Comprehensive verification of correctness properties

The implementation preserves all existing bot functionality while adding valuable proactive notification capabilities for students.
