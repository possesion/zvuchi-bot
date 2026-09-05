const logger = require('./logger');
const { savePhone, getPhone, setNotify } = require('./database');
const { getClientData } = require('./api');
const { pluralize } = require('./utils');
const { syncSchedule } = require('./notifications');

function handleContact(bot) {
    return (msg) => {
        const phoneNumber = msg.contact.phone_number;
        const userId = msg.from.id;
        if (msg.contact.user_id === userId) {
            savePhone(userId, phoneNumber);
            logger.info('Получен и сохранен номер телефона', { 
                user_id: userId, 
                phone: phoneNumber 
            });

            bot.sendMessage(msg.chat.id, `Спасибо! Ваш номер ${phoneNumber} сохранен`, {
                reply_markup: {
                    remove_keyboard: true
                }
            });
        };
    }
}

function handleText(bot) {
    return async (msg) => {
        const userId = msg.from.id;
        const text = msg.text;

        const userPhone = getPhone(userId); 

        if (text === '/start') {
            return bot.sendMessage(msg.chat.id, 'Вы запустили бота!');
        }

        if (text === '/notify') {
            if (!userPhone) {
                return bot.sendMessage(msg.chat.id, 'Сначала поделитесь номером телефона, чтобы подключить уведомления', {
                    reply_markup: {
                        keyboard: [[{ text: '📱 Отправить номер телефона', request_contact: true }]],
                        resize_keyboard: true,
                        one_time_keyboard: true
                    }
                });
            }
            setNotify(userId, true);
            syncSchedule(bot, [userId]).catch(e => logger.error('Ошибка syncSchedule при /notify', { 
                error: e, 
                user_id: userId 
            }));
            return bot.sendMessage(msg.chat.id, 'Уведомления включены! Вы будете получать напоминания о предстоящих занятиях.');
        }

        if (text === '/unsubscribe') {
            setNotify(userId, false);
            return bot.sendMessage(msg.chat.id, 'Уведомления отключены.');
        }

        if (!userPhone) {
            return bot.sendMessage(msg.chat.id, 'Для работы с CRM нужен ваш номер телефона', {
                reply_markup: {
                    keyboard: [[{ text: '📱 Отправить номер телефона', request_contact: true }]],
                    resize_keyboard: true,
                    one_time_keyboard: true
                }
            });
        }

        // 2. Выносим общую логику CRM, чтобы не дублировать try/catch
        if (text === '/lessonstotal' || text === '/nextlesson') {
            try {
                const client = await getClientData(userPhone);
                if (!client) return bot.sendMessage(msg.chat.id, 'Клиент не найден в CRM');

                if (text === '/lessonstotal') {
                    const lessonsText = pluralize(client.paid_count, 'урок', 'урока', 'уроков');
                    await bot.sendMessage(msg.chat.id, `У вас осталось ${client.paid_count} ${lessonsText}`);
                } else {
                    const message = client.next_lesson_date
                        ? `Дата следующего урока – ${client.next_lesson_date}`
                        : 'Урок не запланирован';
                    await bot.sendMessage(msg.chat.id, message);
                }
            } catch (e) {
                logger.error('CRM Error', { 
                    error: e, 
                    user_id: userId, 
                    phone: userPhone 
                });
                await bot.sendMessage(msg.chat.id, 'Ошибка при запросе к CRM. Попробуйте еще раз');
            }
        }
    };
}

module.exports = {
    handleContact,
    handleText
};
