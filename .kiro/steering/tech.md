# Tech Stack

## Runtime & Language

- **Node.js** with **CommonJS** modules (`type: "commonjs"` in package.json)
- **JavaScript** (no TypeScript or build step)

## Core Dependencies

- **node-telegram-bot-api** (^0.67.0): Telegram Bot API wrapper with polling
- **better-sqlite3** (^12.6.2): Synchronous SQLite3 database for local storage
- **dotenv** (^17.2.4): Environment variable management
- **https-proxy-agent** (^9.1.0): HTTPS proxy support for API requests

## Environment Configuration

Required `.env` variables:
- `API_KEY_BOT`: Telegram bot token
- `CRM_EMAIL`: AlfaCRM login email
- `CRM_API_KEY`: AlfaCRM API key

## Common Commands

```bash
# Install dependencies
npm install

# Start the bot
npm start
# or
node index.js
```

## Database

- **SQLite3** database file: `bot.db` (stored in project root)
- Schema: `users` table with `user_id` (PRIMARY KEY), `phone_number`, and `created_at`
- Uses synchronous prepared statements for queries

## External API

- **AlfaCRM v2 API** at `https://zvuchi.s20.online`
- Authentication: Token-based (POST to `/v2api/auth/login`, then `X-ALFACRM-TOKEN` header)
- Token caching with 3500-second TTL
- Client data caching with 60-second TTL
- Automatic retry on 401 errors
