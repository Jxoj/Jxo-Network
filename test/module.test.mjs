import assert from "node:assert/strict";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { createServer, request } from "node:http";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

async function unusedPort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

function requestUpgrade(port, requestPath) {
  return new Promise((resolve, reject) => {
    const req = request({
      host: "127.0.0.1",
      port,
      path: requestPath,
      headers: { Connection: "Upgrade", Upgrade: "websocket" },
    });
    req.once("response", resolve);
    req.once("upgrade", (response, socket) => {
      socket.destroy();
      resolve(response);
    });
    req.once("error", reject);
    req.end();
  });
}

test("Wisp entry point serves and upgrades only at its configured URL path", async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "jnet-wisp-test-"));
  const moduleDir = path.join(dataDir, "modules", "wisp");
  const packageDir = path.join(moduleDir, "node_modules", "@mercuryworkshop", "wisp-js");
  await mkdir(packageDir, { recursive: true });
  await cp(path.join(root, "modules", "wisp", "main.js"), path.join(moduleDir, "main.js"));
  await writeFile(path.join(packageDir, "package.json"), JSON.stringify({
    type: "module",
    exports: { "./server": "./server.mjs" },
  }));
  await writeFile(path.join(packageDir, "server.mjs"), `
export const logging = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, NONE: 4, set_level() {}, info() {} };
export const server = {
  options: {
    allow_private_ips: true,
    allow_loopback_ips: true,
    allow_udp_streams: true,
    port_whitelist: null,
    stream_limit_total: -1,
    stream_limit_per_host: -1,
  },
  routeRequest(_req, socket) {
    const restricted = this.options.allow_private_ips === false &&
      this.options.allow_loopback_ips === false &&
      this.options.allow_udp_streams === false &&
      JSON.stringify(this.options.port_whitelist) === JSON.stringify([80, 443]) &&
      this.options.stream_limit_total === 64 &&
      this.options.stream_limit_per_host === 8;
    socket.write("HTTP/1.1 " + (restricted ? "101 Switching Protocols" : "500 Internal Server Error") + "\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\n\\r\\n");
    socket.destroy();
  },
};
`);

  const port = await unusedPort();
  const child = spawn(process.execPath, [
    path.join(moduleDir, "main.js"),
    "--host", "127.0.0.1",
    "--port", String(port),
    "--path", "/wisp/v1/connection",
  ], { cwd: moduleDir, stdio: ["ignore", "ignore", "pipe"] });
  const childExited = once(child, "exit");
  let stderr = "";
  child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
  t.after(async () => {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await childExited;
    }
    await rm(dataDir, { recursive: true, force: true });
  });

  let ready = false;
  for (let attempt = 0; attempt < 30 && !ready; attempt += 1) {
    if (child.exitCode !== null) break;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/wisp/v1/connection`);
      ready = response.status === 200;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  assert.equal(ready, true, stderr);
  assert.equal((await fetch(`http://127.0.0.1:${port}/other`)).status, 404);
  assert.equal((await requestUpgrade(port, "/other")).statusCode, 404);
  assert.equal((await requestUpgrade(port, "/wisp/v1/connection")).statusCode, 101);
});
