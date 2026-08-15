const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();
const cron = require('node-cron');

const { handleContact, handleText } = require('./src/handlers');
const { runDailyCheck } = require('./src/notifications');
const { startHealthcheckServer } = require('./src/healthcheck');

const bot = new TelegramBot(process.env.API_KEY_BOT, {
    polling: true
});

bot.on('polling_error', (e) => console.log('Ошибка поллинга: ', e));

bot.on('contact', handleContact(bot));
bot.on('text', handleText(bot));

// Запускаем проверку уведомлений каждый день в 00:00 по московскому времени
cron.schedule('0 0 * * *', () => {
    console.log('Запуск ежедневной проверки уведомлений...');
    runDailyCheck(bot).catch((e) => console.error('Ошибка планировщика уведомлений:', e));
}, {
    timezone: 'Europe/Moscow'
});

console.log('Бот запущен...');

startHealthcheckServer();
console.log('Healthcheck сервер запущен');