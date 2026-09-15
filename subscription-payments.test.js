import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadSubscriptionConfig } from "./services/subscription-config.js";
import { PaymentStore } from "./services/payment-store.js";
import { SubscriptionPayments } from "./services/subscription-payments.js";
import { SubscriptionMenu } from "./services/subscription-menu.js";
import { YooKassaClient } from "./providers/yookassa.js";
import { TelegramPollingGateway } from "./services/telegram-gateway.js";
import { createBenzTelegramHandler } from "./services/telegram-bot.js";

const env = {
  YOOKASSA_TEST_ENABLED: "true", YOOKASSA_SHOP_ID: "12345",
  YOOKASSA_SECRET_KEY: "test_fixture_secret", YOOKASSA_RETURN_URL: "https://t.me/fixture_bot?start=payment_return",
};
const owner = { userId: "42", chatId: "42", chatType: "private" };
const paymentId = "23d93cac-000f-5000-8000-126628f15141";

async function fixture(t) {
  const dir = await mkdtemp(join(process.cwd(), "data/payments/test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const settings = loadSubscriptionConfig(env);
  const file = join(dir, "orders.json");
  const calls = [];
  let current;
  let failCreate = false;
  const client = new YooKassaClient({ ...settings, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (options.method === "POST") {
      const request = JSON.parse(options.body);
      current = {
        id: paymentId, test: true, paid: false, status: "pending",
        amount: request.amount, metadata: request.metadata, recipient: { account_id: settings.shopId },
        confirmation: { confirmation_url: "https://yoomoney.ru/checkout/test" },
      };
      if (failCreate) { failCreate = false; throw new Error("Response lost after creation"); }
    }
    return Response.json(current);
  } });
  const createService = () => new SubscriptionPayments({ settings, client, store: new PaymentStore(file), now: () => Date.parse("2026-09-15T12:00:00Z") });
  return { settings, file, calls, createService, service: createService(),
    failNextCreate: () => { failCreate = true; },
    update: (patch) => { Object.assign(current, patch); },
  };
}

// Fixture data stays inside the ignored project payment directory.
import { mkdir } from "node:fs/promises";
await mkdir(join(process.cwd(), "data/payments"), { recursive: true });

test("test configuration rejects live keys, unsafe returns and invalid prices", () => {
  assert.equal(loadSubscriptionConfig({}).enabled, false);
  assert.equal(loadSubscriptionConfig(env).product.amount, "100.00");
  assert.throws(() => loadSubscriptionConfig({ ...env, YOOKASSA_SECRET_KEY: "live_secret" }), /test_/);
  assert.throws(() => loadSubscriptionConfig({ ...env, YOOKASSA_RETURN_URL: "http://example.com" }), /HTTPS/);
  assert.throws(() => loadSubscriptionConfig({ ...env, SUBSCRIPTION_PRICE_RUB: "1.001" }), /SUBSCRIPTION_PRICE/);
  assert.throws(() => loadSubscriptionConfig({ ...env, SUBSCRIPTION_DAYS: "0" }), /SUBSCRIPTION_DAYS/);
});

test("full bot flow: welcome, one product, checkout link, verified test subscription", async (t) => {
  const f = await fixture(t);
  const menu = new SubscriptionMenu(f.service);
  const handler = createBenzTelegramHandler({ subscriptionMenu: menu, findSummary: () => { throw new Error("No search expected"); } });
  const start = await handler({ ...owner, text: "/start" });
  assert.equal(start.replyMarkup.inline_keyboard[0][0].callback_data, "sub:buy");
  const plans = await handler({ ...owner, callbackData: "sub:buy" });
  assert.match(plans.text, /17,5%/);
  const product = await handler({ ...owner, callbackData: "sub:plan:month" });
  assert.match(product.text, /100 ₽ за 30 дней/);
  assert.equal(f.calls.length, 0);
  const payAction = product.replyMarkup.inline_keyboard[0][0].callback_data;
  const checkout = await handler({ ...owner, callbackData: payAction });
  assert.equal(checkout.replyMarkup.inline_keyboard[0][0].url, "https://yoomoney.ru/checkout/test");
  const request = JSON.parse(f.calls[0].options.body);
  assert.deepEqual(request.amount, { value: "100.00", currency: "RUB" });
  assert.equal(request.capture, true);
  assert.equal(request.confirmation.return_url, env.YOOKASSA_RETURN_URL);
  assert.equal(request.save_payment_method, undefined);
  f.update({ status: "succeeded", paid: true, captured_at: "2026-09-15T10:00:00Z" });
  const result = await handler({ ...owner, callbackData: payAction.replace(":pay:", ":check:") });
  assert.match(result.text, /оплата подтверждена/);
  assert.match(result.text, /15.10.2026/);
  assert.match(result.text, /ещё не подключены/);
});

test("uncertain create retries after restart with the same idempotence key and exact body", async (t) => {
  const f = await fixture(t);
  const order = await f.service.draft(owner);
  f.failNextCreate();
  await assert.rejects(f.service.payment(owner, order.id), /Повторите/);
  const restarted = f.createService();
  await restarted.payment(owner, order.id);
  assert.equal(f.calls[0].options.headers["Idempotence-Key"], f.calls[1].options.headers["Idempotence-Key"]);
  assert.equal(f.calls[0].options.body, f.calls[1].options.body);
});

test("parallel clicks share one payment and drafts survive a process restart", async (t) => {
  const f = await fixture(t);
  const [one, two] = await Promise.all([f.service.draft(owner), f.service.draft(owner)]);
  assert.equal(one.id, two.id);
  assert.equal((await f.createService().draft(owner)).id, one.id);
  await Promise.all([f.service.payment(owner, one.id), f.service.payment(owner, one.id)]);
  assert.equal(f.calls.length, 1);
});

test("only the owning private chat can access an order", async (t) => {
  const f = await fixture(t);
  const order = await f.service.draft(owner);
  await assert.rejects(f.service.payment({ userId: "7", chatId: "7" }, order.id), /не найден/);
  await assert.rejects(f.service.payment({ ...owner, chatId: "-1000", chatType: "group" }, order.id), /личный чат/);
  assert.equal(f.calls.length, 0);
});

test("verified success persists and repeated checks never extend expiry", async (t) => {
  const f = await fixture(t);
  const order = await f.service.draft(owner);
  await f.service.payment(owner, order.id);
  f.update({ status: "succeeded", paid: true, captured_at: "2026-09-15T10:00:00Z" });
  const paid = await f.service.payment(owner, order.id);
  const count = f.calls.length;
  const again = await f.createService().payment(owner, order.id);
  assert.equal(paid.expiresAt, "2026-10-15T10:00:00.000Z");
  assert.equal(again.expiresAt, paid.expiresAt);
  assert.equal(f.calls.length, count);
});

test("cancellation activates nothing and allows a new checkout", async (t) => {
  const f = await fixture(t);
  const order = await f.service.draft(owner);
  await f.service.payment(owner, order.id);
  f.update({ status: "canceled" });
  const canceled = await f.service.payment(owner, order.id);
  assert.equal(canceled.expiresAt, undefined);
  assert.notEqual((await f.service.draft(owner)).id, order.id);
});

test("mismatched amount, metadata, merchant, payment ID, test flag and unpaid success cannot activate", async (t) => {
  for (const patch of [
    { amount: { value: "1.00", currency: "RUB" } },
    { metadata: { order_id: "other" } },
    { recipient: { account_id: "other" } },
    { id: "33d93cac-000f-5000-8000-126628f15141" },
    { test: false },
    { status: "succeeded", paid: false, captured_at: "2026-09-15T10:00:00Z" },
  ]) {
    const f = await fixture(t);
    const order = await f.service.draft(owner);
    await f.service.payment(owner, order.id);
    f.update(patch);
    await assert.rejects(f.service.payment(owner, order.id));
    const saved = await f.service.store.transact((state) => state.orders[0]);
    assert.equal(saved.expiresAt, undefined);
    assert.equal(saved.status, "pending");
  }
});

test("uncertain creates outside idempotence retention are blocked rather than charged again", async (t) => {
  const f = await fixture(t);
  const order = await f.service.draft(owner);
  f.failNextCreate();
  await assert.rejects(f.service.payment(owner, order.id));
  f.service.now = () => Date.parse("2026-09-17T12:00:00Z");
  await assert.rejects(f.service.payment(owner, order.id), /кабинете ЮKassa/);
  assert.equal(f.calls.length, 1);
});

test("corrupt storage fails closed without silently replacing saved orders", async (t) => {
  const f = await fixture(t);
  await writeFile(f.file, "broken", "utf8");
  await assert.rejects(f.service.draft(owner), /Хранилище/);
  assert.equal(f.calls.length, 0);
});

test("unconfigured shop still displays the product and pay button without any API call", async (t) => {
  const f = await fixture(t);
  f.settings.enabled = false;
  const menu = new SubscriptionMenu(f.service);
  const product = await menu.handle({ ...owner, callbackData: "sub:plan:month" });
  assert.match(product.replyMarkup.inline_keyboard[0][0].text, /Оплатить/);
  const response = await menu.handle({ ...owner, callbackData: "sub:unavailable" });
  assert.match(response.text, /ожидаем подключение/);
  assert.equal(f.calls.length, 0);
});

test("year selection persists 990 RUB, 365 days and distinct plan metadata", async (t) => {
  const f = await fixture(t);
  const menu = new SubscriptionMenu(f.service);
  const month = await f.service.draft(owner, "month");
  const card = await menu.handle({ ...owner, callbackData: "sub:plan:year" });
  assert.match(card.text, /990 ₽ за 365 дней/);
  const id = card.replyMarkup.inline_keyboard[0][0].callback_data.split(":").at(-1);
  assert.notEqual(id, month.id);
  await f.service.payment(owner, id);
  const request = JSON.parse(f.calls[0].options.body);
  assert.equal(request.amount.value, "990.00");
  assert.equal(request.metadata.plan_id, "year");
  f.update({ status: "succeeded", paid: true, captured_at: "2026-09-15T10:00:00Z" });
  assert.equal((await f.service.payment(owner, id)).expiresAt, "2027-09-15T10:00:00.000Z");
  assert.equal((await f.service.draft(owner, "month")).id, month.id);
});

test("menu and both plans are available before keys; deferred yearly button retains its plan", async (t) => {
  const f = await fixture(t);
  f.settings.enabled = false;
  const menu = new SubscriptionMenu(f.service);
  const home = await menu.handle({ ...owner, text: "/menu" });
  assert.equal(home.replyMarkup.inline_keyboard[0][0].callback_data, "sub:buy");
  const plans = await menu.handle({ ...owner, callbackData: "sub:buy" });
  assert.match(plans.text, /210 ₽/);
  assert.equal(plans.replyMarkup.inline_keyboard[1][0].callback_data, "sub:plan:year");
  const card = await menu.handle({ ...owner, callbackData: "sub:plan:year" });
  const deferred = card.replyMarkup.inline_keyboard[0][0].callback_data;
  assert.equal(deferred, "sub:unavailable:year");
  assert.equal(f.calls.length, 0);
  f.settings.enabled = true;
  const enabledCard = await menu.handle({ ...owner, callbackData: deferred });
  assert.match(enabledCard.text, /990 ₽ за 365 дней/);
});

test("viewing a draft subscription does not create a payment", async (t) => {
  const f = await fixture(t);
  await f.service.draft(owner);
  const response = await new SubscriptionMenu(f.service).handle({ ...owner, text: "/subscription" });
  assert.match(response.replyMarkup.inline_keyboard[0][0].callback_data, /sub:pay:/);
  assert.equal(f.calls.length, 0);
});

test("legacy monthly orders retain their original request and idempotence key", async (t) => {
  const f = await fixture(t);
  const original = await f.service.draft(owner);
  await f.service.store.transact((state) => {
    delete state.orders[0].planId;
    delete state.orders[0].request.metadata.plan_id;
    return true;
  });
  const reused = await f.service.draft(owner, "month");
  assert.equal(reused.id, original.id);
  assert.equal(reused.request.metadata.plan_id, undefined);
  await f.service.payment(owner, reused.id);
  assert.equal(JSON.parse(f.calls[0].options.body).metadata.plan_id, undefined);
});

test("yearly discount is not advertised when custom yearly price has no saving", async (t) => {
  const f = await fixture(t);
  f.settings.plans.year.amount = "1300.00";
  const plans = new SubscriptionMenu(f.service).planReply();
  assert.doesNotMatch(plans.text, /скидка|Выгода/);
  assert.doesNotMatch(plans.replyMarkup.inline_keyboard[1][0].text, /скидка/);
});

test("gateway acknowledges a callback using its actor and delivers inline buttons", async () => {
  const calls = [];
  let normalized;
  const gateway = new TelegramPollingGateway(async (message) => {
    assert.equal(calls[0].method, "answerCallbackQuery");
    normalized = message;
    return { text: "Подписка", replyMarkup: { inline_keyboard: [[{ text: "Купить", callback_data: "sub:buy" }]] } };
  }, { token: "123456789:abcdefghijklmnopqrstuvwxyz", fetchImpl: async (url, options) => {
    calls.push({ method: url.split("/").at(-1), payload: JSON.parse(options.body) });
    return Response.json({ ok: true, result: true });
  } });
  await gateway.handleUpdate({ callback_query: {
    id: "callback", data: "sub:buy", from: { id: 42 },
    message: { from: { id: 999 }, chat: { id: 42, type: "private" }, text: "Menu" },
  } });
  assert.equal(normalized.userId, "42");
  assert.equal(normalized.callbackData, "sub:buy");
  assert.equal(calls[1].payload.reply_markup.inline_keyboard[0][0].text, "Купить");
  assert.equal(calls[1].payload.chat_id, "42");
});

test("provider error bodies and secrets never reach errors", async () => {
  const client = new YooKassaClient({ ...loadSubscriptionConfig(env), fetchImpl: async () => Response.json({ description: env.YOOKASSA_SECRET_KEY }, { status: 401 }) });
  await assert.rejects(client.get(paymentId), (error) => !error.message.includes(env.YOOKASSA_SECRET_KEY));
});

test("an expired callback acknowledgement does not block durable order replay", async () => {
  let handled = false;
  const gateway = new TelegramPollingGateway(async () => { handled = true; return "Готово"; }, {
    token: "123456789:abcdefghijklmnopqrstuvwxyz",
    fetchImpl: async (url) => url.endsWith("answerCallbackQuery")
      ? Response.json({ ok: false, description: "query is too old" }, { status: 400 })
      : Response.json({ ok: true, result: true }),
  });
  await gateway.handleUpdate({ callback_query: { id: "expired", data: "sub:buy", from: { id: 42 }, message: { chat: { id: 42 }, text: "Menu" } } });
  assert.equal(handled, true);
  assert.equal(gateway.processedUpdates, 1);
});

test("subscription menu preserves runtime build information", async () => {
  const handler = createBenzTelegramHandler({
    findSummary: async () => ({}),
    buildInfo: { version: "0.1.38" },
    subscriptionMenu: { handle: async () => ({ text: "Подписка", replyMarkup: { inline_keyboard: [] } }) },
  });
  const response = await handler({ ...owner, text: "/start" });
  assert.match(response.text, /ПО 0.1.38/);
});
