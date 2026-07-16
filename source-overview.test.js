import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { nonSourceWarnings, sourceOverviewRows } from "./public/source-overview.js";

test("lists every known source and exposes T-Bank response metrics", () => {
  const rows = sourceOverviewRows({
    tbank: { available: true, configured: true, role: "availability", returned: 153 },
  }, { tbank: 1 });

  assert.equal(rows.length, 7);
  assert.deepEqual(rows.map((row) => row.key), ["tbank", "alfa", "sber", "gdebenz", "benzup", "multigo", "yandex"]);
  assert.equal(rows[0].status.label, "Работает");
  assert.equal(rows[0].role, "Наличие топлива");
  assert.deepEqual(rows[0].metrics, ["Запросов: 1", "Получено объектов: 153"]);
  assert.equal(rows[1].status.label, "Не подключён");
});

test("places sources and availability in dedicated table sub-tabs", async () => {
  const [html, app] = await Promise.all([
    readFile(new URL("./public/index.html", import.meta.url), "utf8"),
    readFile(new URL("./public/app.js", import.meta.url), "utf8"),
  ]);

  assert.match(html, /data-table-section="stations">\u0410\u0417\u0421<\/button>/);
  assert.match(html, /data-table-section="sources"[^>]*>\u0418\u0441\u0442\u043e\u0447\u043d\u0438\u043a\u0438<\/button>/);
  assert.match(html, /data-table-section="availability"[^>]*>\u0414\u043e\u0441\u0442\u0443\u043f\u043d\u043e\u0441\u0442\u044c \u0438\u0441\u0442\u043e\u0447\u043d\u0438\u043a\u043e\u0432<\/button>/);
  assert.match(html, /id="table-source-list"/);
  assert.match(html, /id="source-errors"/);
  assert.match(app, /sourceOverviewRows\(data\.sources, data\.sourceRequests\)/);
  assert.match(app, /nonSourceWarnings\(data\.warnings, data\.sources\)/);
});

test("keeps provider errors out of the filter sidebar warning", () => {
  const providerError = "T-Bank: не удалось подключиться к источнику.";
  const warnings = nonSourceWarnings([providerError, "Выдача может быть неполной."], {
    tbank: { error: providerError },
  });

  assert.deepEqual(warnings, ["Выдача может быть неполной."]);
});
