const { Bot } = require('node-telegram-bot-api');
require('dotenv').config();
const cron = require('node-cron');
const logger = require('./src/logger');

const { handleContact, handleText } = require('./src/handlers');
const { syncSchedule, processDueNotifications } = require('./src/notifications');
const { startHealthcheckServer } = require('./src/healthcheck');

// Создаем бота с настройками retry для избежания 429 ошибок
const bot = new Bot(process.env.API_KEY_BOT, {
    maxRetries: 3,
    retryBackoffMs: 1000,  // Увеличено с 300ms до 1000ms для снижения частоты retry
});

// Централизованная обработка ошибок
bot.catch((err, ctx) => {
    logger.error('Ошибка обработки update', {
        error: err.message,
        stack: err.stack,
        update_id: ctx?.update?.update_id,
    });
});

// Регистрируем обработчики (порядок важен в v2!)
bot.on('contact', handleContact(bot));
bot.on('message', handleText(bot));

// Запускаем синхронизацию расписания каждый день в 00:00 и 13:00 по московскому времени
// 00:00 MSK = 21:00 UTC (предыдущего дня)
cron.schedule('0 21 * * *', () => {
    logger.info('Запуск ежедневной синхронизации расписания в 00:00 MSK');
    syncSchedule(bot).catch((e) => logger.error('Ошибка syncSchedule', { error: e }));
});

// 13:00 MSK = 10:00 UTC
cron.schedule('0 10 * * *', () => {
    logger.info('Запуск ежедневной синхронизации расписания в 13:00 MSK');
    syncSchedule(bot).catch((e) => logger.error('Ошибка syncSchedule', { error: e }));
});

// Каждые 5 минут проверяем БД и отправляем «созревшие» уведомления (< 24ч до урока)
cron.schedule('*/5 * * * *', () => {
    processDueNotifications(bot).catch((e) => logger.error('Ошибка processDueNotifications', { error: e }));
});

// Запускаем polling
bot.startPolling().then(() => {
    logger.info('Бот запущен и polling активен');
    startHealthcheckServer(bot);
    logger.info('Healthcheck сервер запущен');
}).catch((err) => {
    logger.error('Ошибка запуска бота', { error: err });
    process.exit(1);
});