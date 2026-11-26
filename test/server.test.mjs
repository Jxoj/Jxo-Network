import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createJNetServer } from "../server.mjs";

test("default admin and module ports are separated and legacy settings migrate", async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "jnet-port-test-"));
  t.after(() => rm(dataDir, { recursive: true, force: true }));

  const initial = await createJNetServer({ dataDir, port: 0 });
  const configPath = path.join(dataDir, "config.json");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  delete config.serverPort;
  config.wisp.port = 8080;
  config.chatBackend.port = 8081;
  await writeFile(configPath, JSON.stringify(config));

  const migrated = await createJNetServer({ dataDir });
  assert.equal(migrated.port, Number(process.env.PORT || 8080));
  const migratedConfig = JSON.parse(await readFile(configPath, "utf8"));
  assert.equal(migratedConfig.serverPort, Number(process.env.PORT || 8080));
  assert.equal(migratedConfig.wisp.port, 8090);
  assert.equal(migratedConfig.chatBackend.port, 8091);
  assert.equal(migratedConfig.scramjetPort, 8092);
  assert.notEqual(migratedConfig.serverPort, migratedConfig.wisp.port);
  assert.notEqual(migratedConfig.serverPort, migratedConfig.chatBackend.port);
  assert.notEqual(migratedConfig.serverPort, migratedConfig.scramjetPort);
  assert.notEqual(migratedConfig.wisp.port, migratedConfig.chatBackend.port);
  assert.notEqual(migratedConfig.wisp.port, migratedConfig.scramjetPort);
  assert.notEqual(migratedConfig.chatBackend.port, migratedConfig.scramjetPort);
  assert.equal(initial.port, 0);
});

test("setup key is filesystem-only, consumed during account setup, and API writes require CSRF", async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "jnet-test-"));
  const app = await createJNetServer({ dataDir, port: 0 });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const address = app.server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    await new Promise((resolve, reject) => app.server.close((error) => error ? reject(error) : resolve()));
    await rm(dataDir, { recursive: true, force: true });
  });

  const browserShell = await fetch(`${baseUrl}/app/browser`);
  assert.equal(browserShell.status, 200);
  assert.match(browserShell.headers.get("content-security-policy"), /frame-src http: https:/);
  const browserModule = await fetch(`${baseUrl}/assets/browser.js`);
  assert.equal(browserModule.status, 200);
  assert.match(browserModule.headers.get("content-type"), /javascript/);
  assert.match(await browserModule.text(), /export function mountBrowserApp/);
  const adminShell = await fetch(`${baseUrl}/admin`);
  assert.doesNotMatch(adminShell.headers.get("content-security-policy"), /frame-src http: https:/);

  const key = (await readFile(path.join(dataDir, "key"), "utf8")).trim();
  assert.match(key, /^[A-Za-z0-9_-]{40,}$/);
  assert.equal((await fetch(`${baseUrl}/key`)).status, 404);

  const setupResponse = await fetch(`${baseUrl}/api/setup`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseUrl },
    body: JSON.stringify({ key, username: "admin-user", password: "A-long-setup-password" }),
  });
  assert.equal(setupResponse.status, 201);
  const cookie = setupResponse.headers.get("set-cookie").match(/jnet_session=[a-f0-9]+/)[0];
  await assert.rejects(readFile(path.join(dataDir, "key")));

  assert.equal((await fetch(`${baseUrl}/key`)).status, 404);

  const keyLogin = await fetch(`${baseUrl}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseUrl },
    body: JSON.stringify({ key }),
  });
  assert.equal(keyLogin.status, 401);

  const statusResponse = await fetch(`${baseUrl}/api/status`, { headers: { cookie } });
  assert.equal(statusResponse.status, 200);
  const status = await statusResponse.json();
  assert.equal(status.authenticated, true);

  const rejectedWrite = await fetch(`${baseUrl}/api/settings`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: baseUrl,
      cookie,
    },
    body: JSON.stringify({ port: 5002 }),
  });
  assert.equal(rejectedWrite.status, 403);

  const acceptedWrite = await fetch(`${baseUrl}/api/settings`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: baseUrl,
      cookie,
      "x-jnet-csrf": status.csrfToken,
    },
    body: JSON.stringify({ path: "/wisp/v1/connection", port: 5002 }),
  });
  assert.equal(acceptedWrite.status, 200);
  assert.deepEqual((await acceptedWrite.json()).settings, {
    enabled: true,
    path: "/wisp/v1/connection",
    port: 5002,
  });

  const rejectedPath = await fetch(`${baseUrl}/api/settings`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: baseUrl,
      cookie,
      "x-jnet-csrf": status.csrfToken,
    },
    body: JSON.stringify({ path: "modules/wisp" }),
  });
  assert.equal(rejectedPath.status, 400);
});
