'use strict';

const { getPhone, getSubscribedUsers, setSchedule, clearSchedule, getSchedule, getPendingSchedules, markSent } = require('./database');
const { getClientData } = require('./api');

/**
 * Парсит строку даты занятия из CRM.
 * CRM возвращает время в московской зоне (UTC+3).
 * Парсим через ISO-строку с явным смещением +03:00 чтобы не зависеть
 * от часового пояса сервера.
 * @param {string} dateString - формат "YYYY-MM-DD HH:MM:SS"
 * @returns {Date}
 */
function parseLessonDate(dateString) {
    // "2026-08-25 21:18:01" → "2026-08-25T21:18:01+03:00"
    const isoString = dateString.replace(' ', 'T').replace(/(\d{2}:\d{2}:\d{2})$/, '$1+03:00')
        // на случай если секунд нет: "2026-08-25 21:18" → "2026-08-25T21:18+03:00"
        .replace(/T(\d{2}:\d{2})$/, 'T$1:00+03:00');
    return new Date(isoString);
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
 * @param {object} params
 * @param {string} params.name
 * @param {string} params.next_lesson_date
 * @param {number|null} [params.paid_count]
 * @returns {string}
 */
function formatNotificationMessage({ name, next_lesson_date, paid_count }) {
    const lessonTime = extractTime(next_lesson_date);
    const clientName = name || 'студент';
    let message = `${clientName}, напоминаем о завтрашнем уроке в ${lessonTime}`;
    if (paid_count === 1) {
        message += '\nСледующий урок последний в вашем абонементе. Спасибо, что выбираете студию Звучи!❤️';
    }
    return message;
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
 * Защита от двойной отправки: использует атомарный markSent() — только первый таймер пройдёт.
 * @param {import('node-telegram-bot-api')} bot
 * @param {number} userId
 * @param {string} username
 * @param {string} nextLessonDate
 * @param {number} scheduledAt - Unix timestamp в мс
 */
function scheduleNotification(bot, userId, username, nextLessonDate, scheduledAt) {
    const delay = scheduledAt - Date.now();
    console.log(`Уведомление будет отправлено пользователю ${username}`);
    if (delay <= 0) return; // просрочено — пропустить
    setTimeout(async () => {
        try {
            const record = getSchedule(userId);
            // Защита: дата могла измениться или уже отправлено
            if (!record || record.scheduled_at !== scheduledAt || record.sent) return;
            
            // Атомарная операция: только один таймер пройдёт
            const wasSent = markSent(userId);
            if (!wasSent) {
                console.log(`Уведомление для ${userId} уже отправлено другим таймером`);
                return;
            }
            
            await bot.sendMessage(userId, formatNotificationMessage({
                name: username,
                next_lesson_date: nextLessonDate,
                paid_count: record.paid_count ?? null,
            }));
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
        scheduleNotification(bot, row.user_id, row.name, row.next_lesson_date, row.scheduled_at);
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
            setSchedule(user.user_id, clientData.name, clientData.next_lesson_date, scheduledAt, clientData.paid_count ?? null);
            scheduleNotification(bot, user.user_id, clientData.name, clientData.next_lesson_date, scheduledAt);
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
