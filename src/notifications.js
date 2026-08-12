'use strict';

const { getPhone, getSubscribedUsers } = require('./database');
const { getClientData } = require('./api');

/**
 * Парсит строку даты занятия из CRM.
 * @param {string} dateString - формат "DD.MM.YYYY HH:MM"
 * @returns {Date}
 */
function parseLessonDate(dateString) {
    const [datePart, timePart] = dateString.split(' ');
    const [day, month, year] = datePart.split('.').map(Number);
    const [hours, minutes] = timePart.split(':').map(Number);
    // Месяцы в JS 0-индексированы
    return new Date(year, month - 1, day, hours, minutes);
}

/**
 * Извлекает время HH:MM из строки даты.
 * @param {string} dateString - формат "DD.MM.YYYY HH:MM"
 * @returns {string} "HH:MM"
 */
function extractTime(dateString) {
    const parts = dateString.split(' ');
    return parts[1];
}

/**
 * Определяет, нужно ли сегодня отправлять уведомление.
 * Логика: уведомляем, если занятие запланировано на «завтра»
 * (совпадение по дате — день/месяц/год).
 * Это покрывает оба случая из требований:
 *   • понедельник → уведомление в воскресенье в 00:00
 *   • вт–вс → уведомление ровно за ~24 ч до занятия
 * @param {Date} lessonDate
 * @returns {boolean}
 */
function shouldSendNotification(lessonDate) {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);

    return (
        lessonDate.getDate() === tomorrow.getDate() &&
        lessonDate.getMonth() === tomorrow.getMonth() &&
        lessonDate.getFullYear() === tomorrow.getFullYear()
    );
}

/**
 * Формирует текст уведомления.
 * @param {object} clientData - данные клиента из CRM
 * @returns {string}
 */
function formatNotificationMessage(clientData) {
    const lessonTime = extractTime(clientData.next_lesson_date);
    const clientName = clientData.name || 'студент';
    return `Привет, ${clientName}, завтра в ${lessonTime} у тебя урок по вокалу.`;
}

/**
 * Обёртка над getClientData с одной повторной попыткой.
 * @param {string} phone
 * @param {number} retries
 * @returns {Promise<object|undefined>}
 */
async function getClientDataWithRetry(phone, retries = 1) {
    try {
        return await getClientData(phone);
    } catch (error) {
        if (retries > 0) {
            console.log(`Повтор CRM-запроса для ${phone}...`);
            await new Promise(resolve => setTimeout(resolve, 1000));
            return await getClientDataWithRetry(phone, retries - 1);
        }
        throw error;
    }
}

/**
 * Основной цикл проверки и рассылки уведомлений.
 * Вызывается внешним планировщиком (cron) раз в сутки.
 * @param {import('node-telegram-bot-api')} bot
 */
async function checkAndSendNotifications(bot) {
    const subscribedUsers = getSubscribedUsers();
    console.log(`Проверка уведомлений: ${subscribedUsers.length} подписчиков`);

    for (const user of subscribedUsers) {
        try {
            const phone = getPhone(user.user_id);
            if (!phone) {
                console.log(`Нет номера телефона для пользователя ${user.user_id}, пропускаем`);
                continue;
            }

            let clientData;
            try {
                clientData = await getClientDataWithRetry(phone);
            } catch (error) {
                console.error(`Ошибка CRM для пользователя ${user.user_id}:`, error.message);
                await bot.sendMessage(user.user_id, 'Не могу получить данные об уроке в CRM');
                continue;
            }

            if (!clientData || !clientData.next_lesson_date) {
                await bot.sendMessage(user.user_id, 'Урок не запланирован');
                continue;
            }

            const lessonDate = parseLessonDate(clientData.next_lesson_date);

            if (shouldSendNotification(lessonDate)) {
                const message = formatNotificationMessage(clientData);
                await bot.sendMessage(user.user_id, message);
                console.log(`Уведомление отправлено пользователю ${user.user_id}`);
            }
        } catch (error) {
            console.error(`Ошибка при обработке пользователя ${user.user_id}:`, error.message);
            // Продолжаем обработку остальных пользователей
        }
    }
}

/**
 * Точка входа для cron — экспортируемая функция.
 * @param {import('node-telegram-bot-api')} bot
 */
async function runDailyCheck(bot) {
    await checkAndSendNotifications(bot);
}

module.exports = {
    runDailyCheck,
    // Экспортируем вспомогательные функции для тестирования
    parseLessonDate,
    extractTime,
    shouldSendNotification,
    formatNotificationMessage,
    getClientDataWithRetry
};
