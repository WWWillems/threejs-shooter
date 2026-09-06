import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(new URL("../", import.meta.url)));
const host = process.env.DEPLOY_HOST ?? "bang-bang-api";
const deployPath = process.env.DEPLOY_PATH ?? "/var/www/bang-bang-game";
const processName = process.env.DEPLOY_PROCESS ?? "threejs-shooter-server";

function run(command, args, options = {}) {
  execFileSync(command, args, {
    cwd: root,
    stdio: "inherit",
    ...options,
  });
}

function capture(command, args) {
  return execFileSync(command, args, {
    cwd: root,
    encoding: "utf8",
  }).trim();
}

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

const branch = capture("git", ["branch", "--show-current"]);
if (branch !== "master") {
  throw new Error(`Deploys must come from master; currently on ${branch || "detached HEAD"}`);
}

if (capture("git", ["status", "--porcelain"])) {
  throw new Error("Working tree is not clean; commit or stash changes before deploying");
}

console.log("Building the production server bundle...");
run("npm", ["run", "build:server"]);

if (capture("git", ["status", "--porcelain"])) {
  throw new Error(
    "The server build changed tracked files. Commit server/dist/index.mjs before deploying",
  );
}

console.log("Pushing master...");
run("git", ["push", "origin", "master"]);

const remoteCommand = [
  "set -e",
  `cd ${shellQuote(deployPath)}`,
  "git checkout master",
  "git pull --ff-only origin master",
  "npm ci --omit=dev -w server",
  `pm2 restart ${shellQuote(processName)}`,
].join(" && ");

console.log(`Deploying to ${host}...`);
run("ssh", [host, remoteCommand]);
console.log("Server deployment complete.");
