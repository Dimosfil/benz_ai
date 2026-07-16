const form = document.querySelector("#login-form");
const tokenInput = document.querySelector("#token");
const message = document.querySelector("#message");
const dashboard = document.querySelector("#dashboard");
const cards = document.querySelector("#cards");
const daily = document.querySelector("#daily");
const labels = {
  web_views: "Просмотры сайта",
  web_visitors: "Посетители сайта",
  web_searches: "Поиски на сайте",
  web_bot_events: "События веб-роботов",
  telegram_messages: "Сообщения боту",
  telegram_users: "Пользователи бота",
};

async function loadStats(token) {
  message.textContent = "Загружаем статистику…";
  dashboard.hidden = true;
  const response = await fetch("/api/admin/stats", { headers: { Authorization: `Bearer ${token}` } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(response.status === 401 ? "Неверный токен." : body.error || "Статистика недоступна.");
  sessionStorage.setItem("benz_stats_token", token);
  cards.replaceChildren(...Object.entries(labels).map(([key, label]) => {
    const card = document.createElement("article");
    const value = document.createElement("strong");
    const caption = document.createElement("span");
    value.textContent = Number(body.totals[key] || 0).toLocaleString("ru-RU");
    caption.textContent = label;
    card.append(value, caption);
    return card;
  }));
  daily.replaceChildren(...body.daily.map((row) => {
    const tr = document.createElement("tr");
    [row.day, row.web_views, row.web_visitors, row.web_searches, row.telegram_messages, row.telegram_users].forEach((value) => {
      const td = document.createElement("td");
      td.textContent = value ?? 0;
      tr.append(td);
    });
    return tr;
  }));
  dashboard.hidden = false;
  message.textContent = `Обновлено ${new Date(body.generatedAt).toLocaleString("ru-RU")}.`;
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  loadStats(tokenInput.value).catch((error) => { message.textContent = error.message; });
});

const savedToken = sessionStorage.getItem("benz_stats_token");
if (savedToken) {
  tokenInput.value = savedToken;
  loadStats(savedToken).catch((error) => { message.textContent = error.message; });
}
