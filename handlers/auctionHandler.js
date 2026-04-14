const AuctionDraft = require('../models/AuctionDraft');

module.exports = function (bot) {

    // =========================
    // START AUCTION
    // =========================
    bot.onText(/\/auction/, async (msg) => {
        await AuctionDraft.findOneAndDelete({ telegramId: msg.from.id });

        await AuctionDraft.create({
            telegramId: msg.from.id,
            step: 'title',
            photoFileId: null
        });

        bot.sendMessage(msg.chat.id, 'Введите название товара:');
    });


    // =========================
    // CANCEL COMMAND
    // =========================
    bot.onText(/\/cancel/, async (msg) => {
        await AuctionDraft.findOneAndDelete({ telegramId: msg.from.id });

        bot.sendMessage(msg.chat.id, 'Создание аукциона отменено ❌');
    });


    // =========================
    // FSM
    // =========================
    bot.on('message', async (msg) => {

        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const text = msg.text || '';

        const draft = await AuctionDraft.findOne({ telegramId: userId });

        if (!draft) return;
        if (text.startsWith('/')) return;

        // =========================
        // PHOTO RECEIVED
        // =========================
        if (msg.photo) {

            draft.photoFileId = msg.photo[msg.photo.length - 1].file_id;
            await draft.save();

            return sendPreview(bot, chatId, draft, msg.from);
        }

        // =========================
        // STEPS
        // =========================
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
                draft.startPrice = text;
                draft.step = 'bidStep';
                await draft.save();
                return bot.sendMessage(chatId, 'Введите шаг ставки:');

            case 'bidStep':
                draft.bidStep = text;
                draft.step = 'endTime';
                await draft.save();
                return bot.sendMessage(chatId, 'Введите время окончания:');

            case 'endTime':
                draft.endTime = text;
                draft.step = 'photo';
                await draft.save();
                return bot.sendMessage(chatId, 'Отправьте фото 📸');

            // =========================
            // EDITING MODES
            // =========================
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
                draft.startPrice = text;
                draft.step = 'photo';
                await draft.save();
                return sendPreview(bot, chatId, draft, msg.from);

            case 'edit_bidStep':
                draft.bidStep = text;
                draft.step = 'photo';
                await draft.save();
                return sendPreview(bot, chatId, draft, msg.from);

            case 'edit_endTime':
                draft.endTime = text;
                draft.step = 'photo';
                await draft.save();
                return sendPreview(bot, chatId, draft, msg.from);
        }
    });


    // =========================
    // CALLBACKS
    // =========================
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

            // =========================
            // SEND TO ADMIN
            // =========================
            if (data === 'send') {

                if (!draft.photoFileId) {
                    return bot.sendMessage(chatId, 'Нет фото ❌');
                }

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

            // =========================
            // CANCEL
            // =========================
            if (data === 'cancel') {

                await AuctionDraft.deleteOne({ telegramId: userId });

                await bot.sendMessage(chatId, 'Аукцион отменён ❌');
            }

            // =========================
            // EDIT MENU
            // =========================
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

            // =========================
            // SET EDIT STATES
            // =========================
            if (data.startsWith('edit_')) {

                draft.step = data;
                await draft.save();

                const fieldNames = {
                    edit_title: 'Введите новое название:',
                    edit_description: 'Введите новое описание:',
                    edit_startPrice: 'Введите новую стартовую цену:',
                    edit_bidStep: 'Введите новый шаг ставки:',
                    edit_endTime: 'Введите новое время окончания:'
                };

                return bot.sendMessage(chatId, fieldNames[data]);
            }

        } catch (err) {

            console.log('REAL ERROR:', err);

            await bot.sendMessage(
                chatId,
                'Ошибка: ' + (err.message || 'unknown error')
            );
        }
    });
};


// =========================
// PREVIEW FUNCTION
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

    if (draft.photoFileId) {
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

    return bot.sendMessage(chatId, preview);
}