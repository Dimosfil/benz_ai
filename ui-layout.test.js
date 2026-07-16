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

test("uses a fixed viewport shell with a right filter sidebar", async () => {
  const [html, css] = await Promise.all([
    readFile(projectFile("./public/index.html"), "utf8"),
    readFile(projectFile("./public/styles.css"), "utf8"),
  ]);

  assert.match(html, /<header class="app-header">[\s\S]+id="overview"[\s\S]+role="tablist"/);
  assert.match(html, /class="workspace">[\s\S]+class="view-stage">[\s\S]+class="search-sidebar"/);
  assert.match(css, /html,body\{width:100%;height:100%;overflow:hidden\}/);
  assert.match(css, /\.workspace\{[^}]+grid-template-columns:minmax\(0,1fr\) clamp\(340px,23vw,420px\)/);
  assert.match(css, /\.station-map\{width:100%;height:100%;min-height:0/);
});

test("activates and focuses the map for an explicit search", async () => {
  const [html, css, app] = await Promise.all([
    readFile(projectFile("./public/index.html"), "utf8"),
    readFile(projectFile("./public/styles.css"), "utf8"),
    readFile(projectFile("./public/app.js"), "utf8"),
  ]);

  assert.doesNotMatch(html, /class="map-heading"/);
  assert.match(html, /class="map-shell">\s*<span id="map-count"/);
  assert.match(css, /\.map-section\{display:grid;height:100%;min-height:0;grid-template-rows:minmax\(0,1fr\)/);
  assert.match(css, /\.map-count\{position:absolute;[^}]+top:12px;right:12px/);
  assert.match(app, /loadSummary\(\{ activateMap: true \}\)/);
  assert.match(app, /const mapFocus = matches\.length \? matches : allStations/);
  assert.match(app, /focus: mapFocus/);
});

test("expands the table view across the workspace", async () => {
  const [css, app] = await Promise.all([
    readFile(projectFile("./public/styles.css"), "utf8"),
    readFile(projectFile("./public/app.js"), "utf8"),
  ]);

  assert.match(css, /\.workspace\.table-view\{grid-template-columns:minmax\(0,1fr\)\}/);
  assert.match(css, /\.workspace\.table-view \.search-sidebar\{display:none\}/);
  assert.match(css, /\.table-wrap\{[^}]+width:100%!important/);
  assert.match(app, /workspace\.classList\.toggle\("table-view", !mapActive\)/);
  assert.doesNotMatch(app, /tableWrap\.style\.width/);
});

test("pauses hidden map loading and restores its focus after returning from the table", async () => {
  const app = await readFile(projectFile("./public/app.js"), "utf8");

  assert.match(app, /else stationMap\.deactivate\(\)/);
  assert.match(app, /requestAnimationFrame\(\(\) => requestAnimationFrame\(\(\) => \{/);
  assert.match(app, /if \(activeTab !== "map"\) return/);
  assert.match(app, /stationMap\.activate\(focus\)/);
  assert.match(app, /deferViewportLoad: mapPanel\.hidden/);
});
