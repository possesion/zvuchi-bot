'use strict';

const { getPhone, getSubscribedUsers, setSchedule, clearSchedule, getSchedule, getPendingSchedules, markSent } = require('./database');
const { getClientData } = require('./api');

/**
 * Парсит строку даты занятия из CRM.
 * @param {string} dateString - формат "YYYY-MM-DD HH:MM:SS"
 * @returns {Date}
 */
function parseLessonDate(dateString) {
    const [datePart, timePart] = dateString.split(' ');
    const [year, month, day] = datePart.split('-').map(Number);
    const [hours, minutes] = timePart.split(':').map(Number);
    // Месяцы в JS 0-индексированы
    return new Date(year, month - 1, day, hours, minutes);
}

/**
 * Извлекает время HH:MM из строки даты.
 * @param {string} dateString - формат "YYYY-MM-DD HH:MM:SS"
 * @returns {string} "HH:MM"
 */
function extractTime(dateString) {
    const timePart = dateString.split(' ')[1];
    // Берём только HH:MM, отбрасывая секунды если они есть
    return timePart.slice(0, 5);
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
 * Ставит setTimeout на точный момент отправки уведомления.
 * Просроченные записи (delay <= 0) пропускаются автоматически.
 * Защита от двойной отправки: перед отправкой проверяет актуальность scheduled_at в БД.
 * @param {import('node-telegram-bot-api')} bot
 * @param {number} userId
 * @param {string} nextLessonDate
 * @param {number} scheduledAt - Unix timestamp в мс
 */
function scheduleNotification(bot, userId, nextLessonDate, scheduledAt) {
    const delay = scheduledAt - Date.now();
    console.log(`Уведомление будет отправлено пользователю ${userId} в ${delay}`);
    if (delay <= 0) return; // просрочено — пропустить
    setTimeout(async () => {
        try {
            const record = getSchedule(userId);
            // Защита от двойной отправки: дата могла измениться
            if (!record || record.scheduled_at !== scheduledAt || record.sent) return;
            await bot.sendMessage(userId, formatNotificationMessage({ next_lesson_date: nextLessonDate }));
            markSent(userId);
            console.log(`Уведомление отправлено пользователю ${userId}`);
        } catch (e) {
            console.error(`Ошибка отправки уведомления для ${userId}:`, e.message);
        }
    }, delay);
}

/**
 * Восстанавливает таймеры уведомлений при старте бота.
 * Читает все несработавшие записи из БД и вызывает scheduleNotification.
 * Просроченные записи автоматически пропускаются внутри scheduleNotification.
 * @param {import('node-telegram-bot-api')} bot
 */
async function restoreSchedules(bot) {
    const pending = getPendingSchedules();
    console.log(`Восстановление расписания: ${pending.length} записей`);
    for (const row of pending) {
        scheduleNotification(bot, row.user_id, row.next_lesson_date, row.scheduled_at);
    }
}

/**
 * Синхронизирует расписание из CRM в БД и ставит таймеры уведомлений.
 * Вызывается ежедневно cron'ом или при подписке пользователя (/notify).
 * При ошибке CRM — только console.error, без сообщений пользователю.
 * @param {import('node-telegram-bot-api')} bot
 * @param {number[]|null} userIds - список user_id или null для всех подписчиков
 */
async function syncSchedule(bot, userIds = null) {
    const users = userIds
        ? userIds.map(id => ({ user_id: id }))
        : getSubscribedUsers();
    console.log(`Синхронизация расписания: ${users.length} пользователей`);

    for (const user of users) {
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
                continue; // НЕ отправлять сообщение об ошибке пользователю
            }

            if (!clientData || !clientData.next_lesson_date) {
                clearSchedule(user.user_id);
                continue;
            }

            const existing = getSchedule(user.user_id);
            if (existing && existing.next_lesson_date === clientData.next_lesson_date && existing.sent) {
                continue; // дата не изменилась, уже отправлено — идемпотентность
            }

            const lessonDate = parseLessonDate(clientData.next_lesson_date);
            const scheduledAt = lessonDate.getTime() - 24 * 60 * 60 * 1000;
            setSchedule(user.user_id, clientData.next_lesson_date, scheduledAt);
            scheduleNotification(bot, user.user_id, clientData.next_lesson_date, scheduledAt);
        } catch (error) {
            console.error(`Ошибка при обработке пользователя ${user.user_id}:`, error.message);
        }
    }
}

module.exports = {
    syncSchedule,
    restoreSchedules,
    scheduleNotification,
    parseLessonDate,
    extractTime,
    formatNotificationMessage,
    getClientDataWithRetry,
};
