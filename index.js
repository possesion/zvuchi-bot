const botStartTime = Date.now();
const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();
const cron = require('node-cron');
const logger = require('./src/logger');

const { handleContact, handleText } = require('./src/handlers');
const { syncSchedule, restoreSchedules } = require('./src/notifications');
const { startHealthcheckServer } = require('./src/healthcheck');

const bot = new TelegramBot(process.env.API_KEY_BOT, {
    polling: true
});

restoreSchedules(bot).catch(e => logger.error('Ошибка restoreSchedules', { error: e }));

bot.on('polling_error', (e) => logger.error('Ошибка поллинга', { error: e }));

bot.on('contact', handleContact(bot));
bot.on('text', handleText(bot));

// Запускаем синхронизацию расписания каждый день в 00:00 по московскому времени
// Выполняется в 21:00 UTC, что соответствует 00:00 MSK следующего дня (UTC+3)
cron.schedule('0 21 * * *', () => {
    logger.info('Запуск ежедневной синхронизации расписания');
    syncSchedule(bot).catch((e) => logger.error('Ошибка syncSchedule', { error: e }));
});

logger.info('Бот запущен');

startHealthcheckServer(bot);
logger.info('Healthcheck сервер запущен');