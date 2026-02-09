# Zvuchi Telegram Bot

Telegram бот для работы с CRM системой Zvuchi.

## Установка

```bash
npm install
```

## Настройка

Создайте файл `.env` в корне проекта:

```env
API_KEY_BOT=your_telegram_bot_token
CRM_EMAIL=your_email@example.com
CRM_API_KEY=your_crm_api_key
```

## Запуск

```bash
node index.js
```

## Команды бота

- `/start` - Запуск бота
- `/lessonstotal` - Узнать количество оставшихся уроков
- `/nextlesson` - Узнать дату следующего урока

При первом использовании бот запросит ваш номер телефона для связи с CRM.
