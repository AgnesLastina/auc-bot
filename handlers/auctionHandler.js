const AuctionDraft = require('../models/AuctionDraft');

module.exports = function(bot) {

    // =========================
    // 🚀 START AUCTION
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
    // 🧠 FSM
    // =========================
    bot.on('message', async (msg) => {

        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const text = msg.text || '';

        const draft = await AuctionDraft.findOne({ telegramId: userId });

        if (!draft) return;

        if (text.startsWith('/')) return;

        // =========================
        // 📸 PHOTO SAVE ANYTIME
        // =========================
        if (msg.photo) {

            draft.photoFileId = msg.photo[msg.photo.length - 1].file_id;
            await draft.save();

            const preview = `
🔥 ПРЕДВАРИТЕЛЬНЫЙ ПРОСМОТР 🔥

📦 ${draft.title || '—'}
📝 ${draft.description || '—'}
💰 ${draft.startPrice || '—'}
📈 ${draft.bidStep || '—'}
⏰ ${draft.endTime || '—'}

👤 @${msg.from.username || 'нет username'}
🆔 ${userId}
            `;

            return bot.sendMessage(chatId, preview, {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "✅ Отправить", callback_data: `send_${userId}` }],
                        [{ text: "❌ Отмена", callback_data: `cancel_${userId}` }]
                    ]
                }
            });
        }

        // =========================
        // 🧩 STEPS
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
        }
    });


    // =========================
    // 🔘 CALLBACK HANDLER (FIXED)
    // =========================
    bot.on('callback_query', async (query) => {

        // ⚡ всегда отвечаем сразу
        await bot.answerCallbackQuery(query.id);

        const data = query.data;
        const userId = query.from.id;

        const draft = await AuctionDraft.findOne({ telegramId: userId });

        if (!draft) {
            return bot.sendMessage(query.message.chat.id, 'Черновик не найден ❌');
        }

        try {

            // =========================
            // ✅ SEND TO ADMIN
            // =========================
            if (data.startsWith('send_')) {

                if (!draft.photoFileId) {
                    return bot.sendMessage(query.message.chat.id, 'Нет фото ❌');
                }

                if (!process.env.ADMIN_CHAT_ID) {
                    return bot.sendMessage(query.message.chat.id, 'ADMIN_CHAT_ID не задан ❌');
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

                await bot.sendMessage(query.message.chat.id, 'Аукцион отправлен на модерацию ✅');

                await AuctionDraft.deleteOne({ telegramId: userId });
            }

            // =========================
            // ❌ CANCEL
            // =========================
            if (data.startsWith('cancel_')) {

                await AuctionDraft.deleteOne({ telegramId: userId });

                await bot.sendMessage(query.message.chat.id, 'Аукцион отменён ❌');
            }

        } catch (err) {

            console.log('🔥 REAL ERROR:', err);

            await bot.sendMessage(
                query.message.chat.id,
                'Ошибка: ' + (err.message || 'unknown error')
            );
        }
    });
};