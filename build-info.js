import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

function gitValue(args) {
  try {
    return execFileSync("git", args, { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

export function resolveBuildInfo(env = process.env, readGit = gitValue) {
  let baked = {};
  try { baked = JSON.parse(readFileSync(new URL("./build-metadata.json", import.meta.url), "utf8")); } catch {}
  const injectedCommit = /^(?:|unknown)$/i.test(String(env.GIT_COMMIT_SHA || "").trim()) ? "" : env.GIT_COMMIT_SHA;
  const commit = String(injectedCommit || baked.commit || readGit(["rev-parse", "HEAD"]) || "unknown").trim();
  const committedAt = String(env.GIT_COMMIT_DATE || baked.committedAt || readGit(["show", "-s", "--format=%cI", "HEAD"]) || "").trim() || null;
  return Object.freeze({
    commit,
    shortCommit: commit === "unknown" ? commit : commit.slice(0, 8),
    committedAt,
  });
}

export const buildInfo = resolveBuildInfo();
