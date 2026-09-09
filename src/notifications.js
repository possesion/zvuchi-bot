'use strict';

const logger = require('./logger');
const { getPhone, getSubscribedUsers, setSchedule, clearSchedule, getSchedule, getDueSchedules, markSent } = require('./database');
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
 * Проверяет БД на «созревшие» уведомления и отправляет их.
 * Вызывается cron'ом каждые 5 минут. CRM не запрашивается — работает поверх
 * данных, которые кладёт ежедневный syncSchedule.
 *
 * Логика по каждой due-записи (scheduled_at <= now, sent = 0, notify = 1):
 *   - если урок уже прошёл (now >= lessonDate) — помечаем sent без отправки;
 *   - иначе (в окне < 24ч до урока) — атомарно markSent и отправляем уведомление.
 * Защита от двойной отправки: атомарный markSent() — только один вызов пройдёт.
 * @param {import('node-telegram-bot-api')} bot
 */
async function processDueNotifications(bot) {
    const now = Date.now();
    const due = getDueSchedules(now);
    logger.info('Проверка due-уведомлений', { dueCount: due.length });

    for (const row of due) {
        const { user_id: userId, name } = row;

        try {
            const lessonDate = parseLessonDate(row.next_lesson_date);

            // Урок уже прошёл — не отправляем, но помечаем, чтобы не обрабатывать повторно
            if (now >= lessonDate.getTime()) {
                const isMarked = markSent(userId);
                if (isMarked) {
                    logger.info('Урок уже прошёл, уведомление не отправляется', {
                        name,
                        nextLessonDate: row.next_lesson_date,
                    });
                }
                continue;
            }

            // Атомарная операция: только один проход пройдёт
            const isSent = markSent(userId);
            if (!isSent) {
                logger.info('Уведомление уже отправлено', { name });
                continue;
            }

            try {
                await bot.sendMessage(userId, formatNotificationMessage({
                    name: row.name,
                    next_lesson_date: row.next_lesson_date,
                    paid_count: row.paid_count ?? null,
                }));
                logger.info('Уведомление отправлено пользователю', { name });
            } catch (e) {
                logger.error('Ошибка отправки уведомления', { userId, name, error: e.message, stack: e.stack });
            }
        } catch (e) {
            logger.error('Ошибка обработки due-уведомления', { userId, name, error: e.message, stack: e.stack });
        }
    }
}

/**
 * Синхронизирует расписание из CRM в БД.
 * Вызывается ежедневно cron'ом или при подписке пользователя (/notify).
 * Отправку уведомлений выполняет отдельный cron через processDueNotifications.
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
        } catch (error) {
            logger.error('Ошибка при обработке пользователя', { userId: user.user_id, error: error.message, stack: error.stack });
        }
    }
}

module.exports = {
    syncSchedule,
    processDueNotifications,
    parseLessonDate,
    extractTime,
    formatNotificationMessage,
    getClientDataWithRetry,
};
