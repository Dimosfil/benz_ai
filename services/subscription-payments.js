import { randomUUID } from "node:crypto";

const DAY_MS = 86_400_000;
const ORDER_ID = /^[\da-f-]{36}$/i;

export class SubscriptionPayments {
  constructor({ settings, client, store, now = Date.now }) {
    this.settings = settings;
    this.client = client;
    this.store = store;
    this.now = now;
    this.operations = new Map();
  }

  assertOwner(message) {
    if (!/^\d+$/.test(message.userId || "") || message.chatId !== message.userId
      || (message.chatType && message.chatType !== "private")) {
      throw new Error("Откройте личный чат с ботом для покупки подписки.");
    }
  }

  async draft(message, planId = "month") {
    if (!this.settings.enabled) throw new Error("Тестовая оплата выключена.");
    this.assertOwner(message);
    const product = this.settings.plans[planId];
    if (!product) throw new Error("Неизвестная подписка.");
    return this.store.transact((state) => {
      const existing = state.orders.findLast((order) => order.userId === message.userId
        && (order.planId || "month") === planId
        && !["succeeded", "canceled"].includes(order.status));
      if (existing) return existing;
      if (state.orders.length >= 10_000) throw new Error("Лимит тестовых заказов достигнут.");
      const id = randomUUID();
      const order = {
        id, planId, userId: message.userId, status: "draft", createdAt: this.now(), days: product.days,
        request: {
          amount: { value: product.amount, currency: product.currency },
          capture: true,
          confirmation: { type: "redirect", return_url: this.settings.returnUrl },
          description: `${product.title} — ${product.days} дн. (тест)`,
          metadata: { order_id: id, product_id: product.id, plan_id: planId },
        },
      };
      state.orders.push(order);
      return order;
    });
  }

  async payment(message, id) {
    if (!this.settings.enabled) throw new Error("Тестовая оплата выключена.");
    this.assertOwner(message);
    if (!ORDER_ID.test(id)) throw new Error("Заказ не найден. Нажмите «Купить».");
    const key = `${message.userId}:${id}`;
    if (this.operations.has(key)) return this.operations.get(key);
    const operation = this.syncPayment(message.userId, id).finally(() => this.operations.delete(key));
    this.operations.set(key, operation);
    return operation;
  }

  async syncPayment(userId, id) {
    const order = await this.store.transact((state) => {
      const order = state.orders.find((item) => item.id === id && item.userId === userId);
      if (!order) throw new Error("Заказ не найден. Нажмите «Купить».");
      if (!order.paymentId) {
        if (order.attemptedAt && this.now() - order.attemptedAt > 23 * 60 * 60_000) {
          throw new Error("Результат старого платежа неизвестен. Нужна проверка заказа в кабинете ЮKassa.");
        }
        order.attemptedAt ||= this.now();
      }
      return order;
    });
    if (["succeeded", "canceled"].includes(order.status)) return order;
    const payment = order.paymentId ? await this.client.get(order.paymentId) : await this.client.create(order);
    if (payment.test !== true || payment.metadata?.order_id !== order.id
      || payment.metadata?.product_id !== order.request.metadata.product_id
      || payment.metadata?.plan_id !== order.request.metadata.plan_id
      || payment.amount?.value !== order.request.amount.value
      || payment.amount?.currency !== order.request.amount.currency
      || String(payment.recipient?.account_id) !== this.settings.shopId
      || (order.paymentId && payment.id !== order.paymentId)) {
      throw new Error("Данные платежа не совпадают с заказом. Подписка не активирована.");
    }
    let confirmationUrl = null;
    if (payment.status === "pending") {
      try {
        const url = new URL(payment.confirmation?.confirmation_url);
        if (url.protocol === "https:" && !url.username && !url.password
          && ["yoomoney.ru", "yookassa.ru"].some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) {
          confirmationUrl = url.href;
        }
      } catch { /* reject untrusted or missing redirect below */ }
      if (!confirmationUrl) throw new Error("ЮKassa не вернула корректную ссылку на оплату.");
    }
    const paidAt = Date.parse(payment.captured_at);
    if (payment.status === "succeeded" && (payment.paid !== true || !Number.isFinite(paidAt))) {
      throw new Error("ЮKassa ещё не подтвердила списание. Повторите проверку позже.");
    }
    return this.store.transact((state) => {
      const saved = state.orders.find((item) => item.id === id && item.userId === userId);
      saved.paymentId = payment.id;
      saved.status = payment.status;
      saved.confirmationUrl = confirmationUrl;
      if (payment.status === "succeeded") {
        // Stable provider timestamp: repeated checks never extend the subscription.
        saved.expiresAt = new Date(paidAt + saved.days * DAY_MS).toISOString();
      }
      return saved;
    });
  }
}
