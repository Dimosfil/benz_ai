import { execFileSync } from "node:child_process";

function gitValue(args) {
  try {
    return execFileSync("git", args, { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

export function resolveBuildInfo(env = process.env, readGit = gitValue) {
  const commit = String(env.GIT_COMMIT_SHA || readGit(["rev-parse", "HEAD"]) || "unknown").trim();
  const committedAt = String(env.GIT_COMMIT_DATE || readGit(["show", "-s", "--format=%cI", "HEAD"]) || "").trim() || null;
  return Object.freeze({
    commit,
    shortCommit: commit === "unknown" ? commit : commit.slice(0, 8),
    committedAt,
  });
}

export const buildInfo = resolveBuildInfo();
