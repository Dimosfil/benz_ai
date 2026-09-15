const button = (text, callback_data) => ({ text, callback_data });
const reply = (text, rows) => ({ text, replyMarkup: { inline_keyboard: rows } });

export class SubscriptionMenu {
  constructor(payments) {
    this.payments = payments;
    this.product = payments.settings.product;
  }

  welcome() {
    return reply([
      "👋 Добро пожаловать в Benz AI!",
      `⛽ ${this.product.title}\n${this.product.description}`,
      `${this.product.amount} ₽ / ${this.product.days} дней. Без автопродления.`,
      "Тестовая покупка через ЮKassa. Реальные деньги не списываются.",
      "Поиск по городу доступен обычным сообщением. Примеры — /help.",
    ].join("\n\n"), [[button("🔥 Купить", "sub:buy")], [button("Моя тестовая подписка", "sub:status")]]);
  }

  async handle(message) {
    const text = String(message.text || "").trim();
    const action = message.callbackData || (/^\/buy(?:@\w+)?$/i.test(text) ? "sub:buy"
      : /^\/subscription(?:@\w+)?$/i.test(text) ? "sub:status" : "");
    if (/^\/start(?:@\w+)?(?:\s+payment_return)?$/i.test(text) && !action) return this.welcome();
    if (!action.startsWith("sub:")) return null;
    try {
      this.payments.assertOwner(message);
      if (action === "sub:home") return this.welcome();
      if (action === "sub:buy") {
        const order = this.payments.settings.enabled ? await this.payments.draft(message) : null;
        return this.productReply(order);
      }
      if (!this.payments.settings.enabled) {
        return reply("Оплата временно недоступна: ожидаем подключение магазина ЮKassa. Попробуйте позже.",
          [[button("← Назад", "sub:home")]]);
      }
      if (action === "sub:unavailable") return this.productReply(await this.payments.draft(message));
      if (action === "sub:status") {
        const orders = await this.payments.store.transact((state) => state.orders.filter((order) => order.userId === message.userId));
        const latest = orders.at(-1);
        if (!latest) return reply("У вас пока нет тестовых заказов.", [[button("🔥 Купить", "sub:buy")]]);
        if (latest.status === "draft" && !latest.attemptedAt) return this.productReply(latest);
        return this.orderReply(await this.payments.payment(message, latest.id));
      }
      const match = action.match(/^sub:(?:pay|check):([\da-f-]{36})$/i);
      if (match) return this.orderReply(await this.payments.payment(message, match[1]));
      return "Кнопка устарела. Откройте /start.";
    } catch {
      // Fixed UI messages keep provider/storage diagnostics and identifiers private.
      return reply("Не удалось обработать тестовый заказ. Используйте личный чат с ботом и повторите ту же кнопку позже. Если ошибка повторяется, нужна проверка настроек и заказа администратором.",
        [[button("Моя тестовая подписка", "sub:status"), button("← Назад", "sub:home")]]);
    }
  }

  productReply(order) {
    const amount = order?.request.amount.value || this.product.amount;
    const days = order?.days || this.product.days;
    return reply([
      `⛽ ${this.product.title}`,
      "Что входит в подписку:\n✓ Рассылка предложений по топливу\n✓ Поиск дешёвого бензина рядом\n✓ Данные о вероятном наличии на АЗС",
      `${amount} ₽ за ${days} дней. Без автопродления.`,
      "Сейчас тестируем оплату. Покупка создаёт тестовую подписку; рассылка и поиск по геопозиции ещё не подключены.",
      "Наличие и цены зависят от свежести источников и не гарантируются.",
    ].join("\n\n"), [[button(`💳 Оплатить ${amount} ₽`, order ? `sub:pay:${order.id}` : "sub:unavailable")], [button("← Назад", "sub:home")]]);
  }

  orderReply(order) {
    if (order.status === "succeeded") {
      const date = new Date(order.expiresAt).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" });
      const active = Date.parse(order.expiresAt) > this.payments.now();
      return reply(`✅ Тестовая оплата подтверждена ЮKassa.\n\nТестовая подписка ${active ? "активна до" : "истекла"} ${date} МСК.\nРассылка и поиск по геопозиции ещё не подключены.`,
        [[button("← В меню", "sub:home")]]);
    }
    if (order.status === "canceled") {
      return reply("Платёж отменён. Тестовая подписка не активирована.", [[button("Попробовать снова", "sub:buy")]]);
    }
    return reply("Тестовый платёж ожидает завершения. Откройте ЮKassa, затем вернитесь и нажмите «Проверить оплату».\nРеальные деньги не списываются.", [
      ...(order.confirmationUrl ? [[{ text: `💳 Оплатить ${order.request.amount.value} ₽ в ЮKassa`, url: order.confirmationUrl }]] : []),
      [button("🔄 Проверить оплату", `sub:check:${order.id}`)],
      [button("← В меню", "sub:home")],
    ]);
  }
}
