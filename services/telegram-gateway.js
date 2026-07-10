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
    this.offset = 0;
    this.polling = false;
    this.lastError = null;
    this.abortController = null;
    this.loopPromise = null;
  }

  isConfigured() {
    return isValidTelegramToken(this.token) && typeof this.fetchImpl === "function";
  }

  status() {
    return {
      enabled: this.polling,
      configured: this.isConfigured(),
      lastError: this.lastError,
    };
  }

  start() {
    if (this.polling) return;
    if (!this.isConfigured()) throw new Error("Telegram polling requires a valid TELEGRAM_BOT_TOKEN.");
    this.polling = true;
    this.lastError = null;
    this.loopPromise = this.pollLoop();
  }

  async stop() {
    this.polling = false;
    this.abortController?.abort();
    await this.loopPromise?.catch(() => {});
    this.loopPromise = null;
  }

  async pollOnce() {
    this.abortController = new AbortController();
    const updates = await this.call("getUpdates", {
      offset: this.offset,
      timeout: this.longPollSeconds,
      allowed_updates: ["message"],
    }, this.abortController.signal);

    for (const update of updates) {
      this.offset = Number(update.update_id) + 1;
      await this.handleUpdate(update);
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
    if (!responseText) return;
    await this.call("sendMessage", {
      chat_id: String(message.chat.id),
      text: String(responseText).slice(0, 4096),
      disable_web_page_preview: true,
    });
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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
