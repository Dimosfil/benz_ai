import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { dirname, resolve } from "node:path";

// One polling process owns this file. Serialize reads/writes and replace atomically.
export class PaymentStore {
  constructor(path) {
    this.path = resolve(path);
    this.queue = Promise.resolve();
  }

  transact(action) {
    const operation = this.queue.then(async () => {
      let state;
      try {
        state = JSON.parse(await readFile(this.path, "utf8"));
      } catch (error) {
        if (error.code !== "ENOENT") throw new Error("Хранилище тестовых платежей недоступно.");
        state = { version: 1, orders: [] };
      }
      if (state.version !== 1 || !Array.isArray(state.orders)) {
        throw new Error("Неизвестный формат хранилища платежей.");
      }
      const result = await action(state);
      await mkdir(dirname(this.path), { recursive: true });
      await writeFile(`${this.path}.tmp`, JSON.stringify(state, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
      await rename(`${this.path}.tmp`, this.path);
      return structuredClone(result);
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
}
