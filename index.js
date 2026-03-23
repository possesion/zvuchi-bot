const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

const { handleContact, handleText } = require('./src/handlers');

const bot = new TelegramBot(process.env.API_KEY_BOT, {
    polling: true
});

bot.on('polling_error', console.log);

bot.on('contact', handleContact(bot));
bot.on('text', handleText(bot));

console.log('Бот запущен...');