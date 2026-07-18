const TOKEN_PATTERN = /^\d+:[A-Za-z0-9_-]{20,}$/;

export function isValidTelegramToken(token) {
  return TOKEN_PATTERN.test(String(token || "").trim());
}

export class TelegramPollingGateway {
  constructor(handleMessage, options = {}) {
    this.handleMessage = handleMessage;
    this.token = String(options.token || "").trim();
    this.apiBaseUrl = String(options.apiBaseUrl || "https://api.telegram.org").replace(/\/+$/, "");
    this.longPollSeconds = Number(options.longPollSeconds) || 20;
    this.retryDelayMs = Number(options.retryDelayMs) || 3_000;
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.commands = Array.isArray(options.commands) ? options.commands : [];
    this.description = String(options.description || "").trim();
    this.shortDescription = String(options.shortDescription || "").trim();
    this.offset = 0;
    this.polling = false;
    this.lastError = null;
    this.lastPollAt = null;
    this.lastUpdateAt = null;
    this.processedUpdates = 0;
    this.botProfileConfigured = false;
    this.botProfileError = null;
    this.abortController = null;
    this.loopPromise = null;
    this.profilePromise = null;
  }

  isConfigured() {
    return isValidTelegramToken(this.token) && typeof this.fetchImpl === "function";
  }

  status() {
    return {
      enabled: this.polling,
      configured: this.isConfigured(),
      lastError: this.lastError,
      lastPollAt: this.lastPollAt,
      lastUpdateAt: this.lastUpdateAt,
      processedUpdates: this.processedUpdates,
      botProfileConfigured: this.botProfileConfigured,
      botProfileError: this.botProfileError,
    };
  }

  start() {
    if (this.polling) return;
    if (!this.isConfigured()) throw new Error("Telegram polling requires a valid TELEGRAM_BOT_TOKEN.");
    this.polling = true;
    this.lastError = null;
    this.botProfileError = null;
    this.profilePromise = this.configureBotProfile().catch((error) => {
      this.botProfileConfigured = false;
      this.botProfileError = error instanceof Error ? error.message : String(error);
    });
    this.loopPromise = this.pollLoop();
  }

  async stop() {
    this.polling = false;
    this.abortController?.abort();
    await Promise.all([
      this.loopPromise?.catch(() => {}),
      this.profilePromise?.catch(() => {}),
    ]);
    this.loopPromise = null;
    this.profilePromise = null;
  }

  async configureBotProfile() {
    const requests = [];
    if (this.commands.length) requests.push(this.call("setMyCommands", { commands: this.commands }, AbortSignal.timeout(20_000)));
    if (this.description) requests.push(this.call("setMyDescription", { description: this.description }, AbortSignal.timeout(20_000)));
    if (this.shortDescription) {
      requests.push(this.call("setMyShortDescription", { short_description: this.shortDescription }, AbortSignal.timeout(20_000)));
    }
    await Promise.all(requests);
    this.botProfileConfigured = true;
    this.botProfileError = null;
  }

  async pollOnce() {
    this.abortController = new AbortController();
    const updates = await this.call("getUpdates", {
      offset: this.offset,
      timeout: this.longPollSeconds,
      allowed_updates: ["message"],
    }, combinedSignal(
      this.abortController.signal,
      AbortSignal.timeout((this.longPollSeconds + 20) * 1_000),
    ));
    this.lastPollAt = new Date().toISOString();

    for (const update of updates) {
      const updateId = Number(update?.update_id);
      if (!Number.isSafeInteger(updateId) || updateId < 0) throw new Error("Telegram вернул update без корректного update_id");
      await this.handleUpdate(update);
      this.offset = updateId + 1;
    }
  }

  async handleUpdate(update) {
    const message = update?.message;
    if (!message?.text || message?.chat?.id === undefined) return;
    const responseText = await this.handleMessage({
      chatId: String(message.chat.id),
      userId: String(message.from?.id ?? message.chat.id),
      username: message.from?.username ?? message.from?.first_name ?? null,
      text: message.text,
    });
    if (responseText) {
      for (const chunk of telegramMessageChunks(responseText)) {
        await this.call("sendMessage", {
          chat_id: String(message.chat.id),
          text: chunk,
          disable_web_page_preview: true,
        }, AbortSignal.timeout(20_000));
      }
    }
    this.lastUpdateAt = new Date().toISOString();
    this.processedUpdates += 1;
  }

  async pollLoop() {
    while (this.polling) {
      try {
        await this.pollOnce();
        this.lastError = null;
      } catch (error) {
        if (!this.polling) break;
        this.lastError = error instanceof Error ? error.message : String(error);
        await delay(this.retryDelayMs);
      }
    }
  }

  async call(method, payload, signal) {
    const response = await this.fetchImpl(`${this.apiBaseUrl}/bot${this.token}/${method}`, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json();
    if (!response.ok || body?.ok !== true) {
      throw new Error(body?.description || `Telegram API ${method} failed with HTTP ${response.status}`);
    }
    return body.result;
  }
}

export function telegramMessageChunks(value, limit = 4096) {
  const chunkLimit = Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, 4096) : 4096;
  const text = String(value || "");
  const symbols = typeof Intl.Segmenter === "function"
    ? [...new Intl.Segmenter("ru", { granularity: "grapheme" }).segment(text)].map((item) => item.segment)
    : [...text];
  const chunks = [];
  while (symbols.length) {
    if (symbols.length <= chunkLimit) {
      chunks.push(symbols.splice(0).join(""));
      break;
    }
    let end = chunkLimit;
    for (let index = chunkLimit - 1; index >= Math.floor(chunkLimit * 0.6); index -= 1) {
      if (symbols[index] === "\n") {
        end = index + 1;
        break;
      }
    }
    chunks.push(symbols.splice(0, end).join("").trimEnd());
    while (symbols[0] === "\n") symbols.shift();
  }
  return chunks.filter(Boolean);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function combinedSignal(...signals) {
  return typeof AbortSignal.any === "function" ? AbortSignal.any(signals) : signals[0];
}
