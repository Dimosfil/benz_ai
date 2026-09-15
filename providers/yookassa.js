export class YooKassaClient {
  constructor({ shopId, secretKey, fetchImpl = globalThis.fetch }) {
    this.shopId = shopId;
    this.secretKey = secretKey;
    this.fetchImpl = fetchImpl;
  }

  async request(path, { body, idempotenceKey } = {}) {
    if (!/^\d+$/.test(this.shopId) || !/^test_\S+$/.test(this.secretKey)) {
      throw new Error("Тестовый магазин ЮKassa не настроен.");
    }
    try {
      const response = await this.fetchImpl(`https://api.yookassa.ru/v3/${path}`, {
        method: body ? "POST" : "GET",
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.shopId}:${this.secretKey}`).toString("base64")}`,
          "Content-Type": "application/json",
          ...(idempotenceKey ? { "Idempotence-Key": idempotenceKey } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!response.ok) throw new Error("API error");
      const payment = await response.json();
      if (payment.test !== true || !/^[\da-f-]{36}$/i.test(payment.id)
        || !["pending", "waiting_for_capture", "succeeded", "canceled"].includes(payment.status)) {
        throw new Error("Invalid test payment");
      }
      return payment;
    } catch {
      // Never expose API response bodies, authorization, URLs or network errors.
      throw new Error("Не удалось проверить тестовый платёж в ЮKassa. Повторите попытку позже.");
    }
  }

  create(order) {
    return this.request("payments", { body: order.request, idempotenceKey: order.id });
  }

  get(id) {
    if (!/^[\da-f-]{36}$/i.test(id)) throw new Error("Некорректный платёж.");
    return this.request(`payments/${id}`);
  }
}
