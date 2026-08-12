# Project Structure

## Root Files

- **index.js**: Application entry point - initializes Telegram bot with polling and registers event handlers
- **bot.db**: SQLite database file (auto-created on first run)
- **.env**: Environment variables (git-ignored)
- **package.json**: Dependencies and npm scripts

## Source Directory (`src/`)

The codebase follows a modular structure with separation of concerns:

### `src/handlers.js`
Bot event handlers that process user interactions:
- `handleContact(bot)`: Processes phone number sharing, saves to database
- `handleText(bot)`: Routes text commands (`/start`, `/lessonstotal`, `/nextlesson`)
- Contains business logic for command responses and CRM data formatting

### `src/database.js`
SQLite database operations:
- `savePhone(userId, phone)`: Stores user phone number (strips non-digits)
- `getPhone(userId)`: Retrieves stored phone number for a user
- Manages database schema creation and prepared statements

### `src/api.js`
AlfaCRM API client:
- `getAuthToken()`: Handles authentication with token caching
- `apiRequest(url, payload)`: Generic API request wrapper with auto-retry on 401
- `getClientData(phone)`: Fetches customer data with in-memory caching
- Implements two-level caching strategy (auth tokens + client data)

### `src/utils.js`
Helper utilities:
- `pluralize(count, one, few, many)`: Russian language pluralization for lesson counts

## Architecture Patterns

- **Handler factories**: Handlers are factory functions that take `bot` instance and return the actual handler
- **Synchronous database**: Uses better-sqlite3 for blocking database operations (no async/await needed)
- **Async API calls**: External API requests use async/await with proper error handling
- **Module exports**: Each file exports specific functions via `module.exports`
- **Dependency injection**: Bot instance passed to handler factories for testability
