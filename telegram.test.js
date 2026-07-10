import test from "node:test";
import assert from "node:assert/strict";
import { createBenzTelegramHandler, formatTelegramSummary } from "./services/telegram-bot.js";
import { isValidTelegramToken, TelegramPollingGateway } from "./services/telegram-gateway.js";

test("validates Telegram bot tokens without exposing them", () => {
  assert.equal(isValidTelegramToken("123456789:abcdefghijklmnopqrstuvwxyz"), true);
  assert.equal(isValidTelegramToken("replace-with-token"), false);
});

test("routes a Telegram place message through the shared summary use case", async () => {
  let query;
  const handler = createBenzTelegramHandler({
    findSummary: async (value) => {
      query = value;
      return {
        location: { name: "Воронеж" },
        summary: { total: 12, withPrices: 4, statuses: { available: 5, maybe_available: 2 }, fuels: {} },
        warnings: [],
      };
    },
  });
  const response = await handler({ text: "Воронеж" });
  assert.equal(query, "Воронеж");
  assert.match(response, /АЗС найдено: 12/);
});

test("normalizes a Telegram update and sends the business response", async () => {
  const calls = [];
  const gateway = new TelegramPollingGateway(async (message) => `Найдено для ${message.text}`, {
    token: "123456789:abcdefghijklmnopqrstuvwxyz",
    fetchImpl: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return { ok: true, async json() { return { ok: true, result: {} }; } };
    },
  });
  await gateway.handleUpdate({ update_id: 1, message: { chat: { id: 42 }, from: { id: 7 }, text: "Казань" } });
  assert.match(calls[0].url, /sendMessage$/);
  assert.deepEqual(calls[0].body, {
    chat_id: "42",
    text: "Найдено для Казань",
    disable_web_page_preview: true,
  });
  assert.equal(gateway.status().processedUpdates, 1);
  assert.ok(gateway.status().lastUpdateAt);
});

test("formats the fuel summary without turning it into a factual guarantee", () => {
  const text = formatTelegramSummary({
    location: { name: "Москва" },
    summary: {
      total: 3,
      withPrices: 1,
      statuses: { available: 2, maybe_available: 1 },
      fuels: { 95: { available: 2 } },
    },
    warnings: [],
    stations: [{
      name: "Татнефть",
      address: "Россия, Москва, Тестовая улица, 1",
      overallStatus: "available",
      fuelStatus: { 95: "available" },
      prices: { 95: { value: 70.59 } },
      sourceRefs: [{ source: "tbank" }, { source: "yandex" }],
      lastTransactionAt: "2026-07-10T18:54:42.917Z",
    }],
  });
  assert.match(text, /95: 2 вероятно есть/);
  assert.match(text, /Татнефть/);
  assert.match(text, /Тестовая улица, 1/);
  assert.match(text, /70,59 ₽/);
  assert.match(text, /T‑Bank, Яндекс/);
  assert.match(text, /вероятностный характер/);
});
