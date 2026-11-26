import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createJNetServer } from "../server.mjs";

function listen(server) {
  return new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", onError);
      resolve(server.address().port);
    });
  });
}

function close(server) {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

function probeUpgrade(port, headers) {
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      host: "127.0.0.1",
      port,
      path: "/wisp/",
      headers: {
        Connection: "Upgrade",
        Upgrade: "websocket",
        "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
        "Sec-WebSocket-Version": "13",
        ...headers,
      },
    });
    request.once("response", (response) => {
      response.resume();
      resolve(response.statusCode);
    });
    request.once("upgrade", (response, socket) => {
      socket.destroy();
      resolve(response.statusCode);
    });
    request.once("error", reject);
    request.end();
  });
}

test("Scramjet runs on an isolated authenticated origin without Jnet API routes", async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "jnet-scramjet-test-"));
  const app = await createJNetServer({ dataDir, port: 0, scramjetPort: 0 });
  const adminPort = await listen(app.server);
  const proxyPort = await listen(app.scramjetServer);
  const adminUrl = `http://127.0.0.1:${adminPort}`;
  const proxyUrl = `http://127.0.0.1:${proxyPort}`;
  t.after(async () => {
    await close(app.scramjetServer);
    await close(app.server);
    await rm(dataDir, { recursive: true, force: true });
  });

  assert.equal((await fetch(`${proxyUrl}/`)).status, 401);
  const key = (await readFile(path.join(dataDir, "key"), "utf8")).trim();
  const setup = await fetch(`${adminUrl}/api/setup`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: adminUrl },
    body: JSON.stringify({ key, username: "proxy-admin", password: "A-long-test-password" }),
  });
  assert.equal(setup.status, 201);
  const session = await setup.json();
  const cookie = setup.headers.get("set-cookie").split(";")[0];

  const shell = await fetch(`${proxyUrl}/`, { headers: { cookie } });
  assert.equal(shell.status, 200);
  assert.match(shell.headers.get("content-security-policy"), /frame-src 'self'/);
  assert.match(await shell.text(), /Scramjet Browser/);
  assert.equal((await fetch(`${proxyUrl}/session`, { headers: { cookie } })).status, 200);
  assert.equal((await fetch(`${proxyUrl}/api/status`, { headers: { cookie } })).status, 404);
  assert.equal((await fetch(`${proxyUrl}/controller/controller.api.js`, { headers: { cookie } })).status, 200);
  assert.equal((await fetch(`${proxyUrl}/scramjet/scramjet.wasm`, { headers: { cookie } })).headers.get("content-type"), "application/wasm");

  const blockedCrossOriginWrite = await fetch(`${adminUrl}/api/logout`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: proxyUrl,
      cookie,
      "x-jnet-csrf": session.csrfToken,
    },
    body: "{}",
  });
  assert.equal(blockedCrossOriginWrite.status, 403);

  assert.equal(await probeUpgrade(proxyPort, { origin: proxyUrl }), 401);
  assert.equal(await probeUpgrade(proxyPort, { origin: adminUrl, cookie }), 403);
  assert.equal(await probeUpgrade(proxyPort, {
    origin: `https://127.0.0.1:${proxyPort}`,
    cookie,
  }), 403);
  assert.equal(await probeUpgrade(proxyPort, { origin: proxyUrl, cookie }), 503);

  const invalidPort = await fetch(`${adminUrl}/api/scramjet-settings`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: adminUrl,
      cookie,
      "x-jnet-csrf": session.csrfToken,
    },
    body: JSON.stringify({ port: 8080 }),
  });
  assert.equal(invalidPort.status, 400);

  const updatedPort = await fetch(`${adminUrl}/api/scramjet-settings`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: adminUrl,
      cookie,
      "x-jnet-csrf": session.csrfToken,
    },
    body: JSON.stringify({ port: 8123 }),
  });
  assert.equal(updatedPort.status, 200);
  assert.deepEqual(await updatedPort.json(), {
    settings: { scramjetPort: 8123, restartRequired: true },
  });
});
