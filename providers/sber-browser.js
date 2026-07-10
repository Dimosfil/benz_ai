import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DEFAULT_REFRESH_MS = 60_000;
const ACTIVE_AREA_TTL_MS = 15 * 60_000;
const MAX_ACTIVE_AREAS = 10;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate)) || null;
}

export function chromeArguments(profileDir) {
  return [
    "--headless",
    "--no-startup-window",
    "--disable-gpu",
    "--disable-breakpad",
    "--disable-extensions",
    "--noerrdialogs",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-port=0",
    `--user-data-dir=${profileDir}`,
    "about:blank",
  ];
}

class CdpClient {
  constructor(url) {
    this.url = url;
    this.nextId = 0;
    this.pending = new Map();
    this.socket = null;
  }

  async connect() {
    if (typeof WebSocket !== "function") throw new Error("Для Sber browser worker требуется Node.js 22+");
    this.socket = new WebSocket(this.url);
    this.socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (!message.id || !this.pending.has(message.id)) return;
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    };
    await new Promise((resolve, reject) => {
      this.socket.onopen = resolve;
      this.socket.onerror = () => reject(new Error("Не удалось подключиться к Chrome DevTools"));
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const response = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.text || "Ошибка JavaScript в Chromium");
    return response.result?.value;
  }

  close() {
    try { this.socket?.close(); } catch {}
    for (const pending of this.pending.values()) pending.reject(new Error("Chrome DevTools закрыт"));
    this.pending.clear();
  }
}

export class SberBrowserWorker {
  constructor({ refreshMs = DEFAULT_REFRESH_MS } = {}) {
    this.refreshMs = refreshMs;
    this.chrome = null;
    this.profileDir = null;
    this.cdp = null;
    this.startPromise = null;
    this.refreshing = null;
    this.timer = null;
    this.areas = new Map();
    this.lastError = null;
  }

  async ensureStarted() {
    if (this.cdp) return;
    if (!this.startPromise) this.startPromise = this.start().catch((error) => {
      this.startPromise = null;
      this.lastError = error;
      throw error;
    });
    await this.startPromise;
  }

  async start() {
    const chromePath = findChrome();
    if (!chromePath) throw new Error("Chrome/Edge не найден; задайте CHROME_PATH");
    this.profileDir = await mkdtemp(join(tmpdir(), "benz-ai-sber-"));
    this.chrome = spawn(chromePath, chromeArguments(this.profileDir), {
      stdio: "ignore",
      windowsHide: true,
    });
    this.chrome.once("exit", () => {
      this.cdp?.close();
      this.cdp = null;
      this.startPromise = null;
    });

    const activePortFile = join(this.profileDir, "DevToolsActivePort");
    let port = null;
    let browserWebSocketPath = null;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        const [portLine, webSocketPath] = (await readFile(activePortFile, "utf8")).split(/\r?\n/);
        port = Number(portLine);
        browserWebSocketPath = webSocketPath || null;
        if (Number.isFinite(port)) break;
      } catch {}
      if (this.chrome.exitCode !== null) throw new Error("Chromium завершился до запуска DevTools");
      await wait(250);
    }
    if (!port) throw new Error("Chromium не открыл DevTools endpoint");
    let targets = await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(5_000) }).then((response) => response.json());
    let page = targets.find((target) => target.type === "page");
    if (!page && browserWebSocketPath) {
      const browserCdp = new CdpClient(`ws://127.0.0.1:${port}${browserWebSocketPath}`);
      await browserCdp.connect();
      const { targetId } = await browserCdp.send("Target.createTarget", { url: "about:blank", background: true });
      browserCdp.close();
      targets = await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(5_000) }).then((response) => response.json());
      page = targets.find((target) => target.id === targetId);
    }
    if (!page?.webSocketDebuggerUrl) throw new Error("Chromium не создал страницу DevTools");
    this.cdp = new CdpClient(page.webSocketDebuggerUrl);
    await this.cdp.connect();
    await this.cdp.send("Page.enable");
    await this.cdp.send("Runtime.enable");
    await this.cdp.send("Page.navigate", { url: "https://sberazs.ru/" });

    let ready = false;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await wait(500);
      ready = Boolean(await this.cdp.evaluate("document.cookie.includes('__jhash_') && document.body?.innerText?.includes('КАРТА ЗАПРАВОК')"));
      if (ready) break;
    }
    if (!ready) throw new Error("Sber AZS не завершил браузерную JavaScript-проверку");
    this.lastError = null;
    this.timer = setInterval(() => this.refreshActiveAreas().catch((error) => { this.lastError = error; }), this.refreshMs);
    this.timer.unref();
  }

  areaKey(bbox) {
    return [bbox.minLon, bbox.minLat, bbox.maxLon, bbox.maxLat].map((value) => Number(value).toFixed(5)).join(",");
  }

  async getStations(bbox) {
    const key = this.areaKey(bbox);
    let area = this.areas.get(key);
    if (!area) {
      if (this.areas.size >= MAX_ACTIVE_AREAS) {
        const oldest = [...this.areas.entries()].sort((left, right) => left[1].accessedAt - right[1].accessedAt)[0];
        if (oldest) this.areas.delete(oldest[0]);
      }
      area = { bbox: { ...bbox }, data: null, fetchedAt: 0, accessedAt: Date.now(), error: null };
      this.areas.set(key, area);
    }
    area.accessedAt = Date.now();
    if (!area.data || Date.now() - area.fetchedAt >= this.refreshMs) await this.refreshArea(area);
    if (!area.data && area.error) throw area.error;
    return { ...area.data, fetchedAt: area.fetchedAt, browser: true };
  }

  async refreshArea(area) {
    await this.ensureStarted();
    const bbox = [area.bbox.minLon, area.bbox.minLat, area.bbox.maxLon, area.bbox.maxLat].join(",");
    const expression = `(async()=>{const response=await fetch(${JSON.stringify(`/api/stations?bbox=${bbox}`)},{headers:{Accept:"application/json"}});const text=await response.text();if(!response.ok)throw new Error("Sber HTTP "+response.status);let data;try{data=JSON.parse(text)}catch{throw new Error("Sber вернул не JSON")};return data})()`;
    try {
      area.data = await this.cdp.evaluate(expression);
      area.fetchedAt = Date.now();
      area.error = null;
      this.lastError = null;
    } catch (error) {
      area.error = error;
      this.lastError = error;
      throw error;
    }
  }

  async refreshActiveAreas() {
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      const now = Date.now();
      for (const [key, area] of this.areas) {
        if (now - area.accessedAt > ACTIVE_AREA_TTL_MS) {
          this.areas.delete(key);
          continue;
        }
        try { await this.refreshArea(area); } catch {}
      }
    })().finally(() => { this.refreshing = null; });
    return this.refreshing;
  }

  status() {
    const fetched = [...this.areas.values()].map((area) => area.fetchedAt).filter(Boolean);
    return {
      running: Boolean(this.cdp),
      activeAreas: this.areas.size,
      refreshMs: this.refreshMs,
      lastRefreshAt: fetched.length ? new Date(Math.max(...fetched)).toISOString() : null,
      lastError: this.lastError?.message || null,
    };
  }

  invalidateAll() {
    for (const area of this.areas.values()) {
      area.data = null;
      area.fetchedAt = 0;
      area.error = null;
    }
  }

  async close() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.cdp?.close();
    this.cdp = null;
    const chrome = this.chrome;
    if (chrome && chrome.exitCode === null) {
      const exited = new Promise((resolve) => chrome.once("exit", resolve));
      try { chrome.kill(); } catch {}
      await Promise.race([exited, wait(3_000)]);
    }
    this.chrome = null;
    if (this.profileDir) {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          await rm(this.profileDir, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
          break;
        } catch {
          await wait(250);
        }
      }
    }
    this.profileDir = null;
  }
}
