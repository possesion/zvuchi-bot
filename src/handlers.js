const { savePhone, getPhone } = require('./database');
const { getClientData } = require('./api');
const { pluralize } = require('./utils');

function handleContact(bot) {
    return (msg) => {
        const phoneNumber = msg.contact.phone_number;
        const userId = msg.from.id;
        if (msg.contact.user_id === userId) {
            savePhone(userId, phoneNumber);
            console.log(`Получен и сохранен номер: ${phoneNumber} для пользователя ${userId}`);

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
                console.error('CRM Error:', e);
                await bot.sendMessage(msg.chat.id, 'Ошибка при запросе к CRM');
            }
        }
    };
}

module.exports = {
    handleContact,
    handleText
};
