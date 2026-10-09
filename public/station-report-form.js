import { REPORTABLE_FUELS } from "./fuel-reports.js";
import { fetchJson } from "./api-client.js";

export function createFuelReportForm(station, onSaved) {
  const form = document.createElement("form");
  form.className = "map-popup-report";
  const title = document.createElement("h4");
  title.textContent = "Сообщить об отсутствии бензина";
  const note = document.createElement("p");
  note.textContent = "Отметьте только проверенные марки. Сообщение действует один час и не меняет статус дизеля.";
  const choices = REPORTABLE_FUELS.map((fuel) => {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = true;
    input.value = fuel;
    const text = document.createElement("span");
    text.textContent = `АИ‑${fuel} нет`;
    label.append(input, text);
    return { label, input };
  });
  const confirmation = document.createElement("label");
  const checkedOnSite = document.createElement("input");
  checkedOnSite.type = "checkbox";
  checkedOnSite.required = true;
  const confirmationText = document.createElement("span");
  confirmationText.textContent = "Я проверил на этой АЗС сейчас";
  confirmation.append(checkedOnSite, confirmationText);
  const button = document.createElement("button");
  button.type = "submit";
  button.textContent = "Отправить сообщение";
  const feedback = document.createElement("p");
  feedback.setAttribute("role", "status");
  feedback.setAttribute("aria-live", "polite");
  if (station.reportingAvailable === false) {
    button.disabled = true;
    feedback.textContent = station.reportingUnavailableReason || "Сообщения временно недоступны.";
  }
  form.append(title, note, ...choices.map(({ label }) => label), confirmation, button, feedback);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (button.disabled) return;
    const fuels = choices.filter(({ input }) => input.checked).map(({ input }) => input.value);
    if (!fuels.length || !checkedOnSite.checked) {
      feedback.textContent = "Выберите марку и подтвердите проверку на этой АЗС сейчас.";
      return;
    }
    button.disabled = true;
    feedback.textContent = "Сохраняем сообщение…";
    try {
      const data = await fetchJson("/api/station-reports", {
        method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ sourceRefs: station.sourceRefs?.length ? station.sourceRefs
          : [{ source: station.source, externalId: String(station.externalId) }], fuels, checkedOnSite: true }),
        signal: AbortSignal.timeout(10_000),
      });
      feedback.textContent = "Сообщение сохранено. Статусы отмеченных марок обновлены.";
      checkedOnSite.checked = false;
      onSaved(data.station);
    } catch (error) {
      feedback.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
  return form;
}
