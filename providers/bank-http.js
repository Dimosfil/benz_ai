import { readFileSync } from "node:fs";
import { get } from "node:https";
import { rootCertificates } from "node:tls";
import { Readable, pipeline } from "node:stream";
import { createGunzip } from "node:zlib";

const bankHosts = new Set(["toplivo.tbank.ru", "alfabank.ru"]);
const bankCa = [...rootCertificates, readFileSync(new URL("./certs/russian-trusted-root-ca.pem", import.meta.url), "utf8")];

// Trust the additional CA only for the two public bank feeds. Never change
// system/process trust or disable certificate and hostname verification.
export function usesBankCa(url) {
  const target = new URL(url);
  return target.protocol === "https:" && target.port === "" && bankHosts.has(target.hostname);
}

export async function bankFetch(url, options = {}, redirects = 0) {
  if (!usesBankCa(url)) return globalThis.fetch(url, options);
  const headers = new Headers(options.headers);
  headers.set("Accept-Encoding", "gzip");
  const response = await new Promise((resolve, reject) => {
    const request = get(url, {
      ca: bankCa, rejectUnauthorized: true,
      headers: Object.fromEntries(headers), signal: options.signal,
    }, (incoming) => {
      const responseHeaders = new Headers();
      for (const [key, value] of Object.entries(incoming.headers)) {
        for (const item of Array.isArray(value) ? value : [value]) {
          if (item !== undefined) responseHeaders.append(key, item);
        }
      }
      const noBody = [204, 205, 304].includes(incoming.statusCode);
      if (noBody) incoming.resume();
      let body = incoming;
      if (!noBody && incoming.headers["content-encoding"] === "gzip") {
        body = pipeline(incoming, createGunzip(), () => {});
        responseHeaders.delete("content-encoding");
        responseHeaders.delete("content-length");
      }
      resolve(new Response(noBody ? null : Readable.toWeb(body), {
        status: incoming.statusCode, headers: responseHeaders,
      }));
    });
    request.on("error", reject);
  });
  if ([301, 302, 303, 307, 308].includes(response.status) && options.redirect !== "manual") {
    const location = response.headers.get("location");
    if (!location) return response;
    await response.body?.cancel();
    const next = new URL(location, url);
    if (redirects >= 3 || next.origin !== new URL(url).origin || options.redirect === "error") {
      throw new Error("Банковский API вернул неподдерживаемое перенаправление");
    }
    return bankFetch(next, options, redirects + 1);
  }
  return response;
}
