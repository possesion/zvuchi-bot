const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();
const cron = require('node-cron');
const logger = require('./src/logger');

const { handleContact, handleText } = require('./src/handlers');
const { syncSchedule, processDueNotifications } = require('./src/notifications');
const { startHealthcheckServer } = require('./src/healthcheck');

const bot = new TelegramBot(process.env.API_KEY_BOT, {
    polling: true
});

bot.on('polling_error', (e) => logger.error('Ошибка поллинга', { error: e }));

bot.on('contact', handleContact(bot));
bot.on('text', handleText(bot));

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

logger.info('Бот запущен');

startHealthcheckServer(bot);
logger.info('Healthcheck сервер запущен');