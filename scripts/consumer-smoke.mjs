#!/usr/bin/env node
/**
 * Smoke test for the package as npm users get it.
 *
 *   node scripts/consumer-smoke.mjs <dir where the packed tarball was npm-installed>
 *
 * This repo develops and deploys on Node 22 with cheerio's `undici` overridden to
 * 8.x. People who install the package get neither: npm overrides do not apply to
 * them, so they run cheerio's own undici 7, usually on Node 20. CI runs this script
 * under Node 20 against a clean install of the tarball, so that combination is
 * tested rather than assumed. It uses nothing but Node and the installed package.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import net from "node:net";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const dir = resolve(process.argv[2] ?? ".");
const modules = join(dir, "node_modules");
const pkgDir = join(modules, "@pharmatools", "pubcrawl");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const fail = (message) => {
  console.error(`FAIL: ${message}`);
  process.exit(1);
};

const pkg = readJson(join(pkgDir, "package.json"));
const undiciVersion = readJson(join(modules, "undici", "package.json")).version;
console.log(`node ${process.versions.node} · pubcrawl ${pkg.version} · undici ${undiciVersion}`);

// 1. The dependency tree is the consumer's, not this repo's: no undici 8 override.
if (Number(undiciVersion.split(".")[0]) >= 8) {
  fail(`undici ${undiciVersion} was installed; the repo's override must not reach consumers`);
}

// 2. The stdio server starts, reports its version and lists every tool.
const EXPECTED_TOOLS = 14;
const frames = await new Promise((resolveFrames, reject) => {
  const child = spawn(process.execPath, [join(pkgDir, "dist", "index.js")], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, PUBCRAWL_USAGE_LOG: "off" },
  });
  let out = "";
  let err = "";
  const timer = setTimeout(() => {
    child.kill();
    reject(new Error(`no tool list after 20s. stderr:\n${err}`));
  }, 20_000);
  child.stdout.on("data", (chunk) => {
    out += chunk;
    const lines = out.split("\n").filter(Boolean);
    if (lines.length >= 2) {
      clearTimeout(timer);
      child.kill();
      resolveFrames(lines.map((line) => JSON.parse(line)));
    }
  });
  child.stderr.on("data", (chunk) => (err += chunk));
  child.on("exit", (code) => {
    if (code !== null && code !== 0) {
      clearTimeout(timer);
      reject(new Error(`server exited with code ${code}. stderr:\n${err}`));
    }
  });
  const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
  send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "consumer-smoke", version: "0" } },
  });
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
}).catch((error) => fail(`stdio server did not start: ${error.message}`));

const info = frames.find((f) => f.id === 1)?.result?.serverInfo;
const tools = frames.find((f) => f.id === 2)?.result?.tools ?? [];
if (info?.name !== "pubcrawl" || info?.version !== pkg.version) fail(`unexpected serverInfo ${JSON.stringify(info)}`);
if (tools.length !== EXPECTED_TOOLS) fail(`expected ${EXPECTED_TOOLS} tools, got ${tools.length}`);
console.log(`ok: stdio server ${info.version} lists ${tools.length} tools`);

// 3. The 2026-11-21 crash does not come back. Replay the response that caused it
// (error status, Connection: close, a body nobody reads) through the installed
// package's own helper, with the consumer's undici loaded the way the server loads it.
await import(pathToFileURL(join(modules, "cheerio", "dist", "esm", "index.js")).href);
const { discardBody } = await import(pathToFileURL(join(pkgDir, "dist", "lib", "discard-body.js")).href);
process.on("uncaughtException", (error) => fail(`process would have crashed: ${error.code ?? ""} ${error.message}`));

const body = Buffer.alloc(70_000, 97);
const upstream = net.createServer((socket) => {
  socket.on("error", () => {});
  socket.once("data", () => {
    const head =
      "HTTP/1.1 503 Service Unavailable\r\nContent-Type: text/html\r\n" +
      `Content-Length: ${body.length}\r\nConnection: close\r\n\r\n`;
    socket.end(Buffer.concat([Buffer.from(head), body]));
  });
});
await new Promise((done) => upstream.listen(0, "127.0.0.1", done));
for (let i = 0; i < 5; i++) {
  const response = await fetch(`http://127.0.0.1:${upstream.address().port}/`);
  if (response.status !== 503) fail(`expected 503 from the local upstream, got ${response.status}`);
  await discardBody(response);
  await new Promise((done) => setTimeout(done, 300));
}
upstream.close();
console.log("ok: unread error bodies are discarded without crashing (5 runs)");
process.exit(0);
