export function loadSubscriptionConfig(env = process.env) {
  const enabled = /^(1|true|yes)$/i.test(env.YOOKASSA_TEST_ENABLED || "");
  const amount = env.SUBSCRIPTION_PRICE_RUB || "100.00";
  const days = Number(env.SUBSCRIPTION_DAYS || 30);
  const yearlyAmount = env.SUBSCRIPTION_YEAR_PRICE_RUB || "990.00";
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(yearlyAmount) || Number(yearlyAmount) < 1) {
    throw new Error("SUBSCRIPTION_YEAR_PRICE_RUB must be between 1 and 999999.99 RUB.");
  }
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(amount) || Number(amount) < 1) {
    throw new Error("SUBSCRIPTION_PRICE_RUB must be between 1 and 999999.99 RUB.");
  }
  if (!Number.isInteger(days) || days < 1 || days > 366) {
    throw new Error("SUBSCRIPTION_DAYS must be between 1 and 366.");
  }
  const settings = {
    enabled,
    shopId: String(env.YOOKASSA_SHOP_ID || "").trim(),
    secretKey: String(env.YOOKASSA_SECRET_KEY || "").trim(),
    returnUrl: env.YOOKASSA_RETURN_URL || "",
    dataFile: env.YOOKASSA_DATA_FILE || "data/payments/orders.json",
    product: {
      id: "fuel-subscription",
      title: "Подписка на дешёвый бензин рядом",
      description: "Рассылка предложений и поиск недорогого бензина с вероятным наличием рядом.",
      amount: Number(amount).toFixed(2),
      currency: "RUB",
      days,
    },
  };
  settings.plans = {
    month: { ...settings.product, planId: "month", label: "На месяц" },
    year: { ...settings.product, planId: "year", label: "На год", amount: Number(yearlyAmount).toFixed(2), days: 365 },
  };
  if (enabled) {
    if (!/^\d+$/.test(settings.shopId) || !/^test_\S+$/.test(settings.secretKey)) {
      throw new Error("YOOKASSA_TEST_ENABLED requires a test shop ID and test_ secret key.");
    }
    let url;
    try { url = new URL(settings.returnUrl); } catch { /* validated below */ }
    if (!url || url.protocol !== "https:" || url.username || url.password) {
      throw new Error("YOOKASSA_RETURN_URL must be an HTTPS URL without credentials.");
    }
  }
  return settings;
}
