class StateManager {
  constructor() {
    this.statesByUserId = new Map();
    this.pendingOcrByDraftId = new Map(); // ✅ pending OCR по draftId
  }

  getState(ctx) {
    if (!ctx.session) {
      ctx.session = {};
    }
    if (!ctx.session.fsmState) {
      ctx.session.fsmState = {
        action: null,
        category: null,
        step: null,
        draftId: null,
        templateMessageId: null,
        tempMessages: [],
        awaitingInput: null,
        // ✅ OCR-поля
        pendingOcrData: null,
        ocrMissingFields: [],
        ocrDraftId: null,
        ocrType: null
      };
    }

    if (ctx.from?.id) {
      this.statesByUserId.set(ctx.from.id, ctx.session.fsmState);
    }

    return ctx.session.fsmState;
  }

  getStateByUserId(userId) {
    return this.statesByUserId.get(userId) || null;
  }

  setState(ctx, state) {
    if (!ctx.session) {
      ctx.session = {};
    }
    ctx.session.fsmState = {
      ...ctx.session.fsmState,
      ...state,
      updatedAt: new Date()
    };

    if (ctx.from?.id) {
      this.statesByUserId.set(ctx.from.id, ctx.session.fsmState);
    }
  }

  clearState(ctx) {
    if (ctx.session) {
      ctx.session.fsmState = {
        action: null,
        category: null,
        step: null,
        draftId: null,
        templateMessageId: null,
        tempMessages: [],
        awaitingInput: null,
        pendingOcrData: null,
        ocrMissingFields: [],
        ocrDraftId: null,
        ocrType: null
      };
    }

    if (ctx.from?.id) {
      this.statesByUserId.delete(ctx.from.id);
    }
  }

  updateState(ctx, updates) {
    const current = this.getState(ctx);
    this.setState(ctx, { ...current, ...updates });
  }

  createAuctionState(ctx, category) {
    this.setState(ctx, {
      action: 'creating_auction',
      category,
      step: 'editing',
      draftId: null,
      tempMessages: [],
      awaitingInput: null,
      pendingOcrData: null,
      ocrMissingFields: [],
      ocrDraftId: null,
      ocrType: null
    });
  }

  setAwaitingInput(ctx, field, options = {}) {
    const state = this.getState(ctx);
    const inputOptions = {
      field,
      type: options.type || 'text',
      ...options
    };

    this.setState(ctx, {
      ...state,
      awaitingInput: inputOptions
    });
  }

  clearAwaitingInput(ctx) {
    const state = this.getState(ctx);
    this.setState(ctx, {
      ...state,
      awaitingInput: null
    });
  }

  addTempMessage(ctx, messageId) {
    const state = this.getState(ctx);
    const tempMessages = state.tempMessages || [];
    this.setState(ctx, {
      ...state,
      tempMessages: [...tempMessages, messageId]
    });
  }

  getTempMessages(ctx) {
    const state = this.getState(ctx);
    return state.tempMessages || [];
  }

  clearTempMessages(ctx) {
    const state = this.getState(ctx);
    this.setState(ctx, {
      ...state,
      tempMessages: []
    });
  }

  // ✅ pending OCR данные хранятся по draftId, не в session
  setPendingOcr(draftId, data) {
    const key = String(draftId);
    this.pendingOcrByDraftId.set(key, data);

    // Автоочистка через 30 минут (на случай если юзер забудет)
    const existingTimeout = this.pendingOcrByDraftId.get(`${key}_timeout`);
    if (existingTimeout) clearTimeout(existingTimeout);

    const timeout = setTimeout(() => {
      this.pendingOcrByDraftId.delete(key);
      this.pendingOcrByDraftId.delete(`${key}_timeout`);
      this.pendingOcrByDraftId.delete(`${key}_applied`);
      this.pendingOcrByDraftId.delete(`${key}_applied_at`);
    }, 30 * 60 * 1000);

    this.pendingOcrByDraftId.set(`${key}_timeout`, timeout);
  }

  getPendingOcr(draftId) {
    return this.pendingOcrByDraftId.get(String(draftId)) || null;
  }

  // ✅ НЕ удаляет сразу — оставляет для повторных кликов
  // Данные удалятся автоматически через 30 минут
  markPendingOcrAsApplied(draftId) {
    const key = String(draftId);
    const data = this.pendingOcrByDraftId.get(key);
    if (data) {
      this.pendingOcrByDraftId.set(`${key}_applied`, true);
      this.pendingOcrByDraftId.set(`${key}_applied_at`, Date.now());
    }
  }

  isPendingOcrApplied(draftId) {
    return !!this.pendingOcrByDraftId.get(`${String(draftId)}_applied`);
  }

  clearPendingOcr(draftId) {
    const key = String(draftId);
    const timeout = this.pendingOcrByDraftId.get(`${key}_timeout`);
    if (timeout) clearTimeout(timeout);
    this.pendingOcrByDraftId.delete(key);
    this.pendingOcrByDraftId.delete(`${key}_timeout`);
    this.pendingOcrByDraftId.delete(`${key}_applied`);
    this.pendingOcrByDraftId.delete(`${key}_applied_at`);
  }
}

const stateManager = new StateManager();
module.exports = stateManager;