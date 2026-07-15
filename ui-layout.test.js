import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const projectFile = (name) => new URL(name, import.meta.url);

test("separates map and table results into accessible tabs", async () => {
  const html = await readFile(projectFile("./public/index.html"), "utf8");

  assert.match(html, /role="tablist"/);
  assert.match(html, /id="map-tab"[^>]+aria-controls="map-panel"/);
  assert.match(html, /id="table-tab"[^>]+aria-controls="table-panel"/);
  assert.match(html, /id="map-panel"[^>]+role="tabpanel"/);
  assert.match(html, /id="table-panel"[^>]+role="tabpanel"[^>]+hidden/);
});

test("uses a viewport-sized map and activates it for an explicit search", async () => {
  const [css, app] = await Promise.all([
    readFile(projectFile("./public/styles.css"), "utf8"),
    readFile(projectFile("./public/app.js"), "utf8"),
  ]);

  assert.match(css, /\.map-panel \.station-map\{height:calc\(100dvh - 120px\)/);
  assert.match(app, /loadSummary\(\{ activateMap: true \}\)/);
  assert.match(app, /const mapFocus = matches\.length \? matches : allStations/);
  assert.match(app, /focus: mapFocus/);
});
