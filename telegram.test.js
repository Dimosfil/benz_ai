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
    build: { shortCommit: "abcdef12", committedAt: "2026-07-11T10:30:00+03:00" },
    stations: [{
      name: "Татнефть",
      address: "Россия, Москва, Тестовая улица, 1",
      overallStatus: "available",
      fuelStatus: { 95: "available" },
      prices: { 95: { value: 70.59, currency: "RUB", source: "yandex" } },
      priceUpdatedAt: "10 июля 2026",
      sourceRefs: [{ source: "tbank" }, { source: "yandex" }],
      availabilityBySource: { tbank: { overallStatus: "available", fuelStatus: { 95: "available" } } },
      lastTransactionAt: "2026-07-10T18:54:42.917Z",
    }],
  });
  assert.match(text, /95: 2 вероятно есть/);
  assert.match(text, /Татнефть/);
  assert.match(text, /Тестовая улица, 1/);
  assert.match(text, /70,59 ₽/);
  assert.match(text, /Последние опубликованные цены/);
  assert.match(text, /источник: Яндекс/);
  assert.match(text, /T‑Bank — вероятно есть/);
  assert.match(text, /Яндекс — цены, не наличие/);
  assert.match(text, /вероятностный характер/);
  assert.match(text, /Версия: abcdef12 · коммит 11\.07\.2026, 10:30 МСК/);
});

test("refresh command invokes the uncached summary workflow", async () => {
  let refreshedQuery = null;
  const handler = createBenzTelegramHandler({
    findSummary: async () => { throw new Error("ordinary lookup must not run"); },
    refreshSummary: async (query) => {
      refreshedQuery = query;
      return { location: { name: query }, summary: { total: 0, statuses: {}, fuels: {}, withPrices: 0 }, stations: [], warnings: [] };
    },
  });
  const response = await handler({ text: "/refresh Новая Усмань" });
  assert.equal(refreshedQuery, "Новая Усмань");
  assert.match(response, /Новая Усмань/);
});

test("explains a station-wide negative report separately from empty fuel statuses", () => {
  const text = formatTelegramSummary({
    location: { name: "Бабяково" },
    summary: { total: 1, withPrices: 0, statuses: { available: 0, maybe_available: 0 }, fuels: {} },
    warnings: [],
    stations: [{
      name: "Газпром",
      address: "Россия, Воронежская область, село Бабяково",
      overallStatus: "not_available",
      fuelStatus: { 92: "no_data", DT: "no_data" },
      prices: {},
      sourceRefs: [{ source: "tbank" }, { source: "sber" }, { source: "gdebenz" }, { source: "multigo" }],
      availabilityBySource: {
        tbank: { overallStatus: "no_data", fuelStatus: { 92: "no_data" } },
        sber: { overallStatus: "no_data", fuelStatus: {}, operationsCount: 0 },
        gdebenz: { overallStatus: "not_available", fuelStatus: {}, detail: "Заправка не работает", confirmations: 8, confidence: 0.7435 },
      },
      lastTransactionAt: "2026-07-10T15:46:32.000Z",
    }],
  });
  assert.match(text, /Общий статус относится ко всей АЗС/);
  assert.match(text, /T‑Bank — нет данных/);
  assert.match(text, /Sber — нет данных \(0 операций\)/);
  assert.match(text, /ГдеБЕНЗ — вероятно нет \(«Заправка не работает», 8 подтверждений, уверенность 74%\)/);
  assert.match(text, /Multigo — только карточка АЗС/);
});

test("renders every station fuel on its own line and omits a missing observation date", () => {
  const text = formatTelegramSummary({
    location: { name: "Бабяково" },
    summary: { total: 1, withPrices: 0, statuses: { no_data: 1 }, fuels: {} },
    warnings: [],
    stations: [{
      name: "Газпромнефть",
      address: "Россия, Бабяково",
      overallStatus: "no_data",
      fuelStatus: { 92: "no_data", 95: "no_data", DT: "no_data" },
      prices: {},
      sourceRefs: [{ source: "sber" }],
      availabilityBySource: { sber: { overallStatus: "no_data", fuelStatus: {}, operationsCount: 0 } },
      lastTransactionAt: null,
    }],
  });

  assert.match(text, /⛽ 92: ⚪ нет данных\n⛽ 95: ⚪ нет данных\n⛽ DT: ⚪ нет данных/);
  assert.doesNotMatch(text, /🕒 Данные:/);
  assert.doesNotMatch(text, /01\.01/);
});

test("does not describe a missing Sber operation count as zero operations", () => {
  const text = formatTelegramSummary({
    location: { name: "Бабяково" },
    summary: { total: 1, withPrices: 0, statuses: { no_data: 1 }, fuels: {} },
    warnings: [],
    stations: [{
      name: "Газпромнефть",
      address: "Россия, Бабяково",
      overallStatus: "no_data",
      fuelStatus: { 92: "no_data" },
      prices: {},
      sourceRefs: [{ source: "sber" }],
      availabilityBySource: { sber: { overallStatus: "no_data", fuelStatus: {}, operationsCount: null } },
      lastTransactionAt: null,
    }],
  });

  assert.match(text, /Sber — нет данных/);
  assert.doesNotMatch(text, /0 операций/);
  assert.doesNotMatch(text, /0 подтверждений/);
});
