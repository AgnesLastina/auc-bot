const AuctionDraft = require('../models/AuctionDraft');

module.exports = function (bot) {

    bot.onText(/\/auction/, async (msg) => {
        await AuctionDraft.findOneAndDelete({ telegramId: msg.from.id });

        await AuctionDraft.create({
            telegramId: msg.from.id,
            step: 'title',
            photoFileId: null
        });

        bot.sendMessage(msg.chat.id, 'Введите название товара:');
    });


    bot.onText(/\/cancel/, async (msg) => {
        await AuctionDraft.findOneAndDelete({ telegramId: msg.from.id });

        bot.sendMessage(msg.chat.id, 'Создание аукциона отменено ❌');
    });


    bot.on('message', async (msg) => {

        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const text = msg.text || '';

        const draft = await AuctionDraft.findOne({ telegramId: userId });

        if (!draft) return;
        if (text.startsWith('/')) return;

        if (msg.photo) {
            draft.photoFileId = msg.photo[msg.photo.length - 1].file_id;
            await draft.save();

            return sendPreview(bot, chatId, draft, msg.from);
        }

        switch (draft.step) {

            case 'title':
                draft.title = text;
                draft.step = 'description';
                await draft.save();
                return bot.sendMessage(chatId, 'Введите описание товара:');

            case 'description':
                draft.description = text;
                draft.step = 'startPrice';
                await draft.save();
                return bot.sendMessage(chatId, 'Введите стартовую цену:');

            case 'startPrice':
                if (!isValidPositiveNumber(text)) {
                    return bot.sendMessage(chatId, '❌ Введите корректную стартовую цену (положительное число)');
                }

                draft.startPrice = Number(text);
                draft.step = 'bidStep';
                await draft.save();
                return bot.sendMessage(chatId, 'Введите шаг ставки:');

            case 'bidStep':
                if (!isValidPositiveNumber(text)) {
                    return bot.sendMessage(chatId, '❌ Введите корректный шаг ставки (положительное число)');
                }

                draft.bidStep = Number(text);
                draft.step = 'endTime';
                await draft.save();
                return bot.sendMessage(
                    chatId,
                    'Введите время окончания в формате:\nДД.MM.ГГГГ ЧЧ:ММ\n\nПример: 25.04.2026 18:30'
                );

            case 'endTime': {
                const validation = validateFutureDateTime(text);

                if (!validation.valid) {
                    return bot.sendMessage(chatId, `❌ ${validation.error}`);
                }

                draft.endTime = text;
                draft.step = 'photo';
                await draft.save();
                return bot.sendMessage(chatId, 'Отправьте фото 📸');
            }

            case 'edit_title':
                draft.title = text;
                draft.step = 'photo';
                await draft.save();
                return sendPreview(bot, chatId, draft, msg.from);

            case 'edit_description':
                draft.description = text;
                draft.step = 'photo';
                await draft.save();
                return sendPreview(bot, chatId, draft, msg.from);

            case 'edit_startPrice':
                if (!isValidPositiveNumber(text)) {
                    return bot.sendMessage(chatId, '❌ Введите корректную цену');
                }

                draft.startPrice = Number(text);
                draft.step = 'photo';
                await draft.save();
                return sendPreview(bot, chatId, draft, msg.from);

            case 'edit_bidStep':
                if (!isValidPositiveNumber(text)) {
                    return bot.sendMessage(chatId, '❌ Введите корректный шаг ставки');
                }

                draft.bidStep = Number(text);
                draft.step = 'photo';
                await draft.save();
                return sendPreview(bot, chatId, draft, msg.from);

            case 'edit_endTime': {
                const validation = validateFutureDateTime(text);

                if (!validation.valid) {
                    return bot.sendMessage(chatId, `❌ ${validation.error}`);
                }

                draft.endTime = text;
                draft.step = 'photo';
                await draft.save();
                return sendPreview(bot, chatId, draft, msg.from);
            }
        }
    });


    bot.on('callback_query', async (query) => {

        await bot.answerCallbackQuery(query.id);

        const data = query.data;
        const userId = query.from.id;
        const chatId = query.message.chat.id;

        const draft = await AuctionDraft.findOne({ telegramId: userId });

        if (!draft) {
            return bot.sendMessage(chatId, 'Черновик не найден ❌');
        }

        try {

            if (data === 'send') {

                const postText = `
🔥 АУКЦИОН 🔥

📦 ${draft.title}
📝 ${draft.description}
💰 ${draft.startPrice}
📈 ${draft.bidStep}
⏰ ${draft.endTime}

👤 @${query.from.username || 'нет username'}
🆔 ${userId}
                `;

                await bot.sendPhoto(
                    process.env.ADMIN_CHAT_ID,
                    draft.photoFileId,
                    { caption: postText }
                );

                await bot.sendMessage(chatId, 'Аукцион отправлен на модерацию ✅');

                await AuctionDraft.deleteOne({ telegramId: userId });
            }

            if (data === 'cancel') {
                await AuctionDraft.deleteOne({ telegramId: userId });

                await bot.sendMessage(chatId, 'Аукцион отменён ❌');
            }

            if (data === 'edit') {
                return bot.sendMessage(chatId, 'Что изменить?', {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: 'Название', callback_data: 'edit_title' }],
                            [{ text: 'Описание', callback_data: 'edit_description' }],
                            [{ text: 'Стартовую цену', callback_data: 'edit_startPrice' }],
                            [{ text: 'Шаг ставки', callback_data: 'edit_bidStep' }],
                            [{ text: 'Время окончания', callback_data: 'edit_endTime' }]
                        ]
                    }
                });
            }

            if (data.startsWith('edit_')) {

                draft.step = data;
                await draft.save();

                const prompts = {
                    edit_title: 'Введите новое название:',
                    edit_description: 'Введите новое описание:',
                    edit_startPrice: 'Введите новую стартовую цену:',
                    edit_bidStep: 'Введите новый шаг ставки:',
                    edit_endTime: 'Введите новое время окончания (ДД.MM.ГГГГ ЧЧ:ММ):'
                };

                return bot.sendMessage(chatId, prompts[data]);
            }

        } catch (err) {
            console.log('REAL ERROR:', err);

            await bot.sendMessage(chatId, 'Ошибка: ' + err.message);
        }
    });
};


// =========================
// HELPERS
// =========================
function isValidPositiveNumber(value) {
    return !isNaN(value) && Number(value) > 0;
}

function validateFutureDateTime(value) {
    const regex = /^\d{2}\.\d{2}\.\d{4}\s\d{2}:\d{2}$/;

    if (!regex.test(value)) {
        return {
            valid: false,
            error: 'Неверный формат даты. Используй ДД.MM.ГГГГ ЧЧ:ММ'
        };
    }

    const [datePart, timePart] = value.split(' ');
    const [day, month, year] = datePart.split('.').map(Number);
    const [hour, minute] = timePart.split(':').map(Number);

    const date = new Date(year, month - 1, day, hour, minute);

    const isRealDate =
        date.getFullYear() === year &&
        date.getMonth() === month - 1 &&
        date.getDate() === day &&
        date.getHours() === hour &&
        date.getMinutes() === minute;

    if (!isRealDate) {
        return {
            valid: false,
            error: 'Указана несуществующая дата'
        };
    }

    if (date <= new Date()) {
        return {
            valid: false,
            error: 'Дата окончания должна быть в будущем'
        };
    }

    return { valid: true };
}


// =========================
// PREVIEW
// =========================
async function sendPreview(bot, chatId, draft, user) {

    const preview = `
🔥 ПРЕДВАРИТЕЛЬНЫЙ ПРОСМОТР 🔥

📦 ${draft.title || '—'}
📝 ${draft.description || '—'}
💰 ${draft.startPrice || '—'}
📈 ${draft.bidStep || '—'}
⏰ ${draft.endTime || '—'}

👤 @${user.username || 'нет username'}
🆔 ${user.id}
    `;

    return bot.sendPhoto(chatId, draft.photoFileId, {
        caption: preview,
        reply_markup: {
            inline_keyboard: [
                [{ text: '✅ Отправить', callback_data: 'send' }],
                [{ text: '✏️ Изменить', callback_data: 'edit' }],
                [{ text: '❌ Отмена', callback_data: 'cancel' }]
            ]
        }
    });
}