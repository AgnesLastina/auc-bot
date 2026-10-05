/**
 * Утилиты для параллельных запросов к Telegram API.
 */

async function cleanupAndAnswer(ctx, messageIds = [], answerText = undefined, options = {}) {
  const tasks = [];

  for (const id of messageIds) {
    if (id) {
      tasks.push(ctx.telegram.deleteMessage(ctx.chat.id, id).catch(() => {}));
    }
  }

  if (answerText !== undefined) {
    tasks.push(ctx.answerCbQuery(answerText, options).catch(() => {}));
  }

  await Promise.all(tasks);
}

async function deleteAndAnswer(ctx, answerText = undefined, options = {}) {
  await Promise.all([
    ctx.deleteMessage().catch(() => {}),
    answerText !== undefined
      ? ctx.answerCbQuery(answerText, options).catch(() => {})
      : Promise.resolve()
  ]);
}

async function deleteMessages(ctx, messageIds = []) {
  await Promise.all(
    messageIds.filter(Boolean).map(id =>
      ctx.telegram.deleteMessage(ctx.chat.id, id).catch(() => {})
    )
  );
}

module.exports = { cleanupAndAnswer, deleteAndAnswer, deleteMessages };