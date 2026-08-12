# Product Overview

Zvuchi Bot is a Telegram bot that integrates with the Zvuchi CRM system (powered by AlfaCRM). The bot allows students to check their lesson balance and upcoming lesson schedules directly through Telegram.

## Core Features

- **Phone number registration**: Users share their phone number to link their Telegram account with CRM records
- **Lesson balance inquiry**: Check remaining paid lessons (`/lessonstotal`)
- **Schedule lookup**: View next scheduled lesson date (`/nextlesson`)

## Target Users

Students enrolled in Zvuchi's educational services who need quick access to their lesson information.

## Technical Integration

The bot communicates with the AlfaCRM API hosted at `zvuchi.s20.online`, authenticating via email and API key, then querying customer data by phone number.
