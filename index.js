const botStartTime = Date.now();
const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();
const cron = require('node-cron');

const { handleContact, handleText } = require('./src/handlers');
const { syncSchedule, restoreSchedules } = require('./src/notifications');
const { startHealthcheckServer } = require('./src/healthcheck');

const bot = new TelegramBot(process.env.API_KEY_BOT, {
    polling: true
});

restoreSchedules(bot).catch(e => console.error('Ошибка restoreSchedules:', e));

bot.on('polling_error', (e) => console.log('Ошибка поллинга: ', e));

bot.on('contact', handleContact(bot));
bot.on('text', handleText(bot));

// Запускаем синхронизацию расписания каждый день в 00:00 по московскому времени
cron.schedule('0 0 * * *', () => {
    console.log('Запуск ежедневной синхронизации расписания...');
    syncSchedule(bot).catch((e) => console.error('Ошибка syncSchedule:', e));
}, {
    timezone: 'Europe/Moscow'
});

console.log('Бот запущен...');

startHealthcheckServer();
console.log('Healthcheck сервер запущен');