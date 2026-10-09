import test from "node:test";
import assert from "node:assert/strict";
import { createFuelReportForm } from "./public/station-report-form.js";

function element() {
  return { children: [], handlers: {}, textContent: "", append(...items) { this.children.push(...items); },
    setAttribute() {}, addEventListener(event, fn) { this.handlers[event] = fn; } };
}

test("report form requires on-site confirmation, sends only selected petrol grades and keeps errors retryable", async (t) => {
  const originalDocument = globalThis.document, originalFetch = globalThis.fetch;
  t.after(() => { globalThis.document = originalDocument; globalThis.fetch = originalFetch; });
  globalThis.document = { createElement: element };
  let calls = 0, saved = null;
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(url, "/api/station-reports");
    assert.deepEqual(JSON.parse(options.body), { sourceRefs: [{ source: "sber", externalId: "one" }], fuels: ["95"], checkedOnSite: true });
    return calls === 1 ? Response.json({ error: "Не удалось сохранить сообщение." }, { status: 503 })
      : Response.json({ station: { name: "Тестовая АЗС" } }, { status: 201 });
  };
  const form = createFuelReportForm({ sourceRefs: [{ source: "sber", externalId: "one" }] }, (station) => { saved = station; });
  const [,, ai92, , confirmation, button, feedback] = form.children;
  await form.handlers.submit({ preventDefault() {} });
  assert.equal(calls, 0);
  assert.match(feedback.textContent, /подтвердите/);
  ai92.children[0].checked = false;
  confirmation.children[0].checked = true;
  await form.handlers.submit({ preventDefault() {} });
  assert.match(feedback.textContent, /Не удалось сохранить/);
  assert.equal(button.disabled, false);
  assert.equal(saved, null);
  await form.handlers.submit({ preventDefault() {} });
  assert.equal(saved.name, "Тестовая АЗС");
  assert.match(feedback.textContent, /сохранено/);
});
