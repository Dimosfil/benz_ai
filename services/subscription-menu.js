const button = (text, callback_data) => ({ text, callback_data });
const reply = (text, rows) => ({ text, replyMarkup: { inline_keyboard: rows } });
const rubles = (value) => Number(value).toLocaleString("ru-RU", { maximumFractionDigits: 2 });

export class SubscriptionMenu {
  constructor(payments) {
    this.payments = payments;
    this.product = payments.settings.product;
  }

  welcome() {
    return reply([
      "👋 Добро пожаловать в Benz AI!",
      `⛽ ${this.product.title}\n${this.product.description}`,
      "Подписка на месяц или год. Нажмите «Купить», чтобы выбрать срок. Без автопродления.",
      "Тестовая покупка через ЮKassa. Реальные деньги не списываются.",
      "Поиск по городу доступен обычным сообщением. Примеры — /help.",
    ].join("\n\n"), [[button("🔥 Купить", "sub:buy")], [button("Моя тестовая подписка", "sub:status")]]);
  }

  async handle(message) {
    const text = String(message.text || "").trim();
    const action = message.callbackData || (/^\/buy(?:@\w+)?$/i.test(text) ? "sub:buy"
      : /^\/subscription(?:@\w+)?$/i.test(text) ? "sub:status" : "");
    if (/^\/(?:start|menu)(?:@\w+)?(?:\s+payment_return)?$/i.test(text) && !action) return this.welcome();
    if (!action.startsWith("sub:")) return null;
    try {
      this.payments.assertOwner(message);
      if (action === "sub:home") return this.welcome();
      if (action === "sub:buy") {
        return this.planReply();
      }
      const selection = action.match(/^sub:plan:(month|year)$/);
      if (selection) {
        const planId = selection[1];
        const order = this.payments.settings.enabled ? await this.payments.draft(message, planId) : null;
        return this.productReply(order, planId);
      }
      if (!this.payments.settings.enabled) {
        return reply("Оплата временно недоступна: ожидаем подключение магазина ЮKassa. Попробуйте позже.",
          [[button("← Выбрать подписку", "sub:buy")], [button("🏠 Главное меню", "sub:home")]]);
      }
      const deferred = action.match(/^sub:unavailable(?::(month|year))?$/);
      if (deferred) {
        const planId = deferred[1] || "month";
        return this.productReply(await this.payments.draft(message, planId), planId);
      }
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

  planReply() {
    const { month, year } = this.payments.settings.plans;
    const saving = Number(month.amount) * 12 - Number(year.amount);
    const discount = saving > 0 ? ` — скидка ${(saving / (Number(month.amount) * 12) * 100).toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%` : "";
    return reply([
      "⛽ Выберите подписку",
      `Месяц (${month.days} дней) — ${rubles(month.amount)} ₽`,
      `Год (${year.days} дней) — ${rubles(year.amount)} ₽${discount}`,
      ...(saving > 0 ? [`Выгода ${rubles(saving)} ₽ по сравнению с 12 месячными подписками.`] : []),
      "В обоих тарифах: рассылка предложений и поиск дешёвого бензина рядом. Без автопродления.",
    ].join("\n\n"), [
      [button(`На месяц — ${rubles(month.amount)} ₽`, "sub:plan:month")],
      [button(`На год — ${rubles(year.amount)} ₽${discount}`, "sub:plan:year")],
      [button("🏠 Главное меню", "sub:home")],
    ]);
  }

  productReply(order, planId = order?.planId || "month") {
    const plan = this.payments.settings.plans[planId];
    const amount = order?.request.amount.value || plan.amount;
    const days = order?.days || plan.days;
    return reply([
      `⛽ ${this.product.title}`,
      "Что входит в подписку:\n✓ Рассылка предложений по топливу\n✓ Поиск дешёвого бензина рядом\n✓ Данные о вероятном наличии на АЗС",
      `${plan.label}: ${rubles(amount)} ₽ за ${days} дней. Без автопродления.`,
      "Сейчас тестируем оплату. Покупка создаёт тестовую подписку; рассылка и поиск по геопозиции ещё не подключены.",
      "Наличие и цены зависят от свежести источников и не гарантируются.",
    ].join("\n\n"), [[button(`💳 Оплатить ${rubles(amount)} ₽`, order ? `sub:pay:${order.id}` : `sub:unavailable:${planId}`)], [button("← Выбрать подписку", "sub:buy")], [button("🏠 Главное меню", "sub:home")]]);
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
