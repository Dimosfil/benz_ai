import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DEFAULT_REFRESH_MS = 60_000;
const ACTIVE_AREA_TTL_MS = 15 * 60_000;
const MAX_ACTIVE_AREAS = 10;
const DEFAULT_BROWSER_IDLE_MS = 30_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 12_000;
const CDP_COMMAND_TIMEOUT_MS = 15_000;

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
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate)) || null;
}

export function chromeArguments(profileDir) {
  const args = [
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
  if (/^(1|true|yes)$/i.test(String(process.env.CHROME_NO_SANDBOX || ""))) {
    args.splice(1, 0, "--no-sandbox");
  }
  return args;
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
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    };
    await new Promise((resolve, reject) => {
      this.socket.onopen = resolve;
      this.socket.onerror = () => reject(new Error("Не удалось подключиться к Chrome DevTools"));
    });
  }

  send(method, params = {}, timeoutMs = CDP_COMMAND_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Chrome DevTools timeout: ${method}`));
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });
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
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Chrome DevTools закрыт"));
    }
    this.pending.clear();
  }
}

export class SberBrowserWorker {
  constructor({
    refreshMs = DEFAULT_REFRESH_MS,
    activeAreaTtlMs = ACTIVE_AREA_TTL_MS,
    maxActiveAreas = MAX_ACTIVE_AREAS,
    browserIdleMs = DEFAULT_BROWSER_IDLE_MS,
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  } = {}) {
    this.refreshMs = refreshMs;
    this.activeAreaTtlMs = activeAreaTtlMs;
    this.maxActiveAreas = maxActiveAreas;
    this.browserIdleMs = browserIdleMs;
    this.requestTimeoutMs = requestTimeoutMs;
    this.chrome = null;
    this.profileDir = null;
    this.cdp = null;
    this.startPromise = null;
    this.closePromise = null;
    this.refreshing = null;
    this.timer = null;
    this.idleTimer = null;
    this.areas = new Map();
    this.activeOperations = 0;
    this.lastActivityAt = null;
    this.lastStartedAt = null;
    this.lastStoppedAt = null;
    this.lastStopReason = null;
    this.stopping = false;
    this.lastError = null;
  }

  async ensureStarted() {
    if (this.closePromise) await this.closePromise;
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
    const chrome = spawn(chromePath, chromeArguments(this.profileDir), {
      stdio: "ignore",
      windowsHide: true,
    });
    this.chrome = chrome;
    chrome.once("exit", () => {
      if (this.chrome !== chrome) return;
      this.cdp?.close();
      this.cdp = null;
      this.startPromise = null;
      if (!this.stopping) this.recordStop("browser_exit");
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
    this.lastStartedAt = new Date().toISOString();
    this.lastStopReason = null;
    this.timer = setInterval(() => this.refreshActiveAreas().catch((error) => { this.lastError = error; }), this.refreshMs);
    this.timer.unref();
  }

  recordStop(reason) {
    this.lastStoppedAt = new Date().toISOString();
    this.lastStopReason = reason;
  }

  clearIdleClose() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  scheduleIdleClose() {
    if (!this.cdp || this.areas.size || this.activeOperations || this.refreshing || this.idleTimer) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.cdp && !this.areas.size && !this.activeOperations && !this.refreshing) {
        this.close("idle_timeout").catch((error) => { this.lastError = error; });
      }
    }, this.browserIdleMs);
    this.idleTimer.unref();
  }

  beginOperation() {
    this.activeOperations += 1;
    this.lastActivityAt = Date.now();
    this.clearIdleClose();
  }

  endOperation() {
    this.activeOperations = Math.max(0, this.activeOperations - 1);
    this.lastActivityAt = Date.now();
    this.scheduleIdleClose();
  }

  areaKey(bbox) {
    return [bbox.minLon, bbox.minLat, bbox.maxLon, bbox.maxLat].map((value) => Number(value).toFixed(5)).join(",");
  }

  async getStations(bbox) {
    this.beginOperation();
    try {
      const key = this.areaKey(bbox);
      let area = this.areas.get(key);
      if (!area) {
        if (this.areas.size >= this.maxActiveAreas) {
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
    } finally {
      this.endOperation();
    }
  }

  async refreshArea(area) {
    await this.ensureStarted();
    const bbox = [area.bbox.minLon, area.bbox.minLat, area.bbox.maxLon, area.bbox.maxLat].join(",");
    const expression = `(async()=>{const response=await fetch(${JSON.stringify(`/api/stations?bbox=${bbox}`)},{headers:{Accept:"application/json"},signal:AbortSignal.timeout(${this.requestTimeoutMs})});const text=await response.text();if(!response.ok)throw new Error("Sber HTTP "+response.status);let data;try{data=JSON.parse(text)}catch{throw new Error("Sber вернул не JSON")};return data})()`;
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
    if (!this.areas.size) {
      this.scheduleIdleClose();
      return;
    }
    this.beginOperation();
    const refresh = (async () => {
      const now = Date.now();
      try {
        for (const [key, area] of this.areas) {
          if (now - area.accessedAt > this.activeAreaTtlMs) {
            this.areas.delete(key);
            continue;
          }
          try { await this.refreshArea(area); } catch {}
        }
      } finally {
        this.endOperation();
      }
    })();
    this.refreshing = refresh;
    return refresh.finally(() => {
      if (this.refreshing === refresh) this.refreshing = null;
      this.scheduleIdleClose();
    });
  }

  status() {
    const fetched = [...this.areas.values()].map((area) => area.fetchedAt).filter(Boolean);
    return {
      running: Boolean(this.cdp),
      lifecycle: this.closePromise ? "stopping" : this.cdp ? (this.activeOperations ? "busy" : this.areas.size ? "ready" : "idle") : "stopped",
      activeAreas: this.areas.size,
      activeOperations: this.activeOperations,
      refreshMs: this.refreshMs,
      activeAreaTtlMs: this.activeAreaTtlMs,
      browserIdleMs: this.browserIdleMs,
      requestTimeoutMs: this.requestTimeoutMs,
      lastActivityAt: this.lastActivityAt ? new Date(this.lastActivityAt).toISOString() : null,
      lastStartedAt: this.lastStartedAt,
      lastStoppedAt: this.lastStoppedAt,
      lastStopReason: this.lastStopReason,
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

  async close(reason = "shutdown") {
    if (this.closePromise) return this.closePromise;
    this.closePromise = this.stop(reason).finally(() => { this.closePromise = null; });
    return this.closePromise;
  }

  async stop(reason) {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.clearIdleClose();
    this.stopping = true;
    this.cdp?.close();
    this.cdp = null;
    const chrome = this.chrome;
    if (chrome && chrome.exitCode === null) {
      const exited = new Promise((resolve) => chrome.once("exit", resolve));
      try { chrome.kill(); } catch {}
      await Promise.race([exited, wait(3_000)]);
    }
    this.chrome = null;
    this.startPromise = null;
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
    this.stopping = false;
    this.recordStop(reason);
  }
}
