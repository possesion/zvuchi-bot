'use strict';

const logger = require('./logger');
const { getPhone, getSubscribedUsers, setSchedule, clearSchedule, getSchedule, getPendingSchedules, markSent } = require('./database');
const { getClientData } = require('./api');

/**
 * Парсит строку даты занятия из CRM.
 * CRM возвращает время в московской зоне (UTC+3).
 * Конвертируем MSK → UTC математически: создаём UTC timestamp и вычитаем 3 часа.
 * Это обеспечивает корректную работу независимо от часового пояса сервера (Docker UTC).
 * @param {string} dateString - формат "YYYY-MM-DD HH:MM:SS" (московское время)
 * @returns {Date} - Date объект в UTC с корректным смещением от MSK
 */
function parseLessonDate(dateString) {
    // "2026-09-05 12:30:01" -> Date(2026-09-05T09:30:00.000Z) в UTC
    const [datePart, timePart] = dateString.split(' ');
    const [year, month, day] = datePart.split('-').map(Number);
    const [hours, minutes] = timePart.split(':').map(Number);
    
    // Создаём UTC timestamp, интерпретируя компоненты как MSK
    const utcTimestamp = Date.UTC(year, month - 1, day, hours, minutes);
    
    // Вычитаем 3 часа (MSK offset), так как MSK = UTC+3
    const mskOffset = 3 * 60 * 60 * 1000; // 10800000 ms
    const correctedTimestamp = utcTimestamp - mskOffset;
    
    // Возвращаем Date объект с корректным UTC timestamp
    return new Date(correctedTimestamp);
}

/**
 * Извлекает время HH:MM из строки даты.
 * @param {string} dateString - формат "YYYY-MM-DD HH:MM:SS"
 * @returns {string} "HH:MM"
 */
function extractTime(dateString) {
    const timePart = dateString.split(' ')[1];
    return timePart;
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
    let message = `Привет, ${clientName}, завтра в ${lessonTime} у тебя урок по вокалу.`;
    if (paid_count === 1) {
        message += '\nСледующий урок последний в твоём абонементе. Спасибо, что выбираешь студию Звучи!❤️';
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
            logger.info('Повтор CRM-запроса', { phone, retriesLeft: retries });
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
    const delayHours = (delay / 1000 / 60 / 60).toFixed(1);
    const scheduledDate = new Date(scheduledAt).toISOString();
    logger.info('Уведомление будет отправлено пользователю', { 
        userId, 
        username, 
        nextLessonDate, 
        scheduledAt,
        scheduledDate,
        delayHours: `${delayHours} часов`
    });
    if (delay <= 0) return; // просрочено — пропустить
    setTimeout(async () => {
        try {
            const record = getSchedule(userId);
            // Защита: дата могла измениться или уже отправлено
            if (!record || record.scheduled_at !== scheduledAt || record.sent) return;
            
            // Атомарная операция: только один таймер пройдёт
            const wasSent = markSent(userId);
            if (!wasSent) {
                logger.info('Уведомление уже отправлено другим таймером', { userId });
                return;
            }
            
            await bot.sendMessage(userId, formatNotificationMessage({
                name: username,
                next_lesson_date: nextLessonDate,
                paid_count: record.paid_count ?? null,
            }));
            logger.info('Уведомление отправлено пользователю', { userId });
        } catch (e) {
            logger.error('Ошибка отправки уведомления', { userId, error: e.message, stack: e.stack });
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
    logger.info('Восстановление расписания', { pendingCount: pending.length });
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
    logger.info('Синхронизация расписания', { userCount: users.length });

    for (const user of users) {
        try {
            const phone = getPhone(user.user_id);
            if (!phone) {
                logger.info('Нет номера телефона для пользователя, пропускаем', { userId: user.user_id });
                continue;
            }

            let clientData;
            try {
                clientData = await getClientDataWithRetry(phone);
            } catch (error) {
                logger.error('Ошибка CRM для пользователя', { userId: user.user_id, phone, error: error.message, stack: error.stack });
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
            setSchedule(user.user_id, clientData.next_lesson_date, scheduledAt, clientData.name, clientData.paid_count ?? null);
            scheduleNotification(bot, user.user_id, clientData.name, clientData.next_lesson_date, scheduledAt);
        } catch (error) {
            logger.error('Ошибка при обработке пользователя', { userId: user.user_id, error: error.message, stack: error.stack });
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
