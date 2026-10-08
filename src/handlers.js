const logger = require('./logger');
const { savePhone, getPhone, setNotify } = require('./database');
const { getClientData } = require('./api');
const { pluralize } = require('./utils');
const { syncSchedule } = require('./notifications');

function handleContact(bot) {
    return async (ctx) => {
        // В v2 структура немного другая, но поля остаются теми же
        const contact = ctx.message?.contact;
        if (!contact) return;

        const phoneNumber = contact.phone_number;
        const userId = ctx.from?.id;
        
        if (!userId) return;

        if (contact.user_id === userId) {
            savePhone(userId, phoneNumber);
            logger.info('Получен и сохранен номер телефона', {
                user_id: userId,
                phone: phoneNumber
            });

            await bot.api.sendMessage({
                chat_id: ctx.chat.id,
                text: `Спасибо! Ваш номер ${phoneNumber} сохранен`,
                reply_markup: {
                    remove_keyboard: true
                }
            });
        }
    }
}

function handleText(bot) {
    return async (ctx) => {
        // В v2: ctx.message содержит само сообщение
        const message = ctx.message;
        if (!message || !message.text) return; // Пропускаем не-текстовые сообщения

        const userId = ctx.from?.id;
        const text = message.text;
        
        if (!userId) return;

        const userPhone = getPhone(userId);

        if (text === '/start') {
            return bot.api.sendMessage({
                chat_id: ctx.chat.id,
                text: 'Вы запустили бота!'
            });
        }

        if (text === '/notify') {
            if (!userPhone) {
                return bot.api.sendMessage({
                    chat_id: ctx.chat.id,
                    text: 'Поделитесь номером телефона, чтобы подключить уведомления',
                    reply_markup: {
                        keyboard: [[{ text: '📱 Отправить номер телефона', request_contact: true }]],
                        resize_keyboard: true,
                        one_time_keyboard: true
                    }
                });
            }
            setNotify(userId, true);
            logger.info('Уведомления включены для ', userId);
            syncSchedule(bot, [userId]).catch(e => logger.error('Ошибка syncSchedule при /notify', {
                error: e,
                user_id: userId
            }));
            return bot.api.sendMessage({
                chat_id: ctx.chat.id,
                text: 'Уведомления включены! Вы будете получать напоминания о предстоящих занятиях.'
            });
        }

        if (text === '/unsubscribe') {
            setNotify(userId, false);
            logger.info('Уведомления отключены для ', userId);
            return bot.api.sendMessage({
                chat_id: ctx.chat.id,
                text: 'Уведомления отключены.'
            });
        }

        if (!userPhone) {
            return bot.api.sendMessage({
                chat_id: ctx.chat.id,
                text: 'Для работы с CRM нужен ваш номер телефона',
                reply_markup: {
                    keyboard: [[{ text: '📱 Отправить номер телефона', request_contact: true }]],
                    resize_keyboard: true,
                    one_time_keyboard: true
                }
            });
        }

        // Выносим общую логику CRM, чтобы не дублировать try/catch
        if (text === '/lessonstotal' || text === '/nextlesson') {
            try {
                const client = await getClientData(userPhone);
                if (!client) {
                    return bot.api.sendMessage({
                        chat_id: ctx.chat.id,
                        text: 'Клиент не найден в CRM'
                    });
                }

                if (text === '/lessonstotal') {
                    const lessonsText = pluralize(client.paid_count, 'урок', 'урока', 'уроков');
                    await bot.api.sendMessage({
                        chat_id: ctx.chat.id,
                        text: `У вас осталось ${client.paid_count} ${lessonsText}`
                    });
                    logger.info('Отправлены данные об оставшихся уроках', {
                        name: client.name,
                        paidCount: client.paid_count,
                    });
                } else {
                    logger.info('Отправлены данные о следующем уроке', {
                        name: client.name,
                        nextLesson: client.next_lesson_date,
                    });
                    const messageText = client.next_lesson_date
                        ? `Дата следующего урока – ${client.next_lesson_date}`
                        : 'Урок не запланирован';
                    await bot.api.sendMessage({
                        chat_id: ctx.chat.id,
                        text: messageText
                    });
                }
            } catch (e) {
                logger.error('CRM Error', {
                    error: e,
                    user_id: userId,
                    phone: userPhone
                });
                await bot.api.sendMessage({
                    chat_id: ctx.chat.id,
                    text: 'Ошибка при запросе к CRM. Попробуйте еще раз'
                });
            }
        }
    };
}

module.exports = {
    handleContact,
    handleText
};
