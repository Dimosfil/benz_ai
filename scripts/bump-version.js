import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function nextPatchVersion(value) {
  const match = String(value || "").match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) throw new Error(`Версия должна соответствовать SemVer: ${value}`);
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

function packageFromHead() {
  try {
    return JSON.parse(execFileSync("git", ["show", "HEAD:package.json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
  } catch {
    return null;
  }
}

export function bumpPackageVersion(packagePath = resolve("package.json")) {
  const current = JSON.parse(readFileSync(packagePath, "utf8"));
  const previous = packageFromHead();
  if (!previous || current.version === previous.version) current.version = nextPatchVersion(current.version);
  writeFileSync(packagePath, `${JSON.stringify(current, null, 2)}\n`, "utf8");
  execFileSync("git", ["add", "--", packagePath], { stdio: "inherit" });
  return current.version;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`Benz AI version: ${bumpPackageVersion()}`);
}
