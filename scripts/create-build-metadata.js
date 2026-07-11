import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function metadataFromGitHeadLog(rawLog) {
  const line = String(rawLog || "").trim().split(/\r?\n/).at(-1) || "";
  const match = line.match(/^[0-9a-f]{40}\s+([0-9a-f]{40})\s+.+?\s+(\d+)\s+[+-]\d{4}\t/u);
  if (!match) throw new Error("Не удалось извлечь метаданные последнего коммита из .git/logs/HEAD");
  return {
    commit: match[1],
    shortCommit: match[1].slice(0, 8),
    committedAt: new Date(Number(match[2]) * 1000).toISOString(),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , inputPath, outputPath] = process.argv;
  writeFileSync(outputPath, `${JSON.stringify(metadataFromGitHeadLog(readFileSync(inputPath, "utf8")), null, 2)}\n`, "utf8");
}
