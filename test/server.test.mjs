import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createJNetServer } from "../server.mjs";

test("bootstrap key is loopback-only, one-time after login, and API writes require CSRF", async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "jnet-test-"));
  const app = await createJNetServer({ dataDir, port: 0 });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const address = app.server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    await new Promise((resolve, reject) => app.server.close((error) => error ? reject(error) : resolve()));
    await rm(dataDir, { recursive: true, force: true });
  });

  const keyResponse = await fetch(`${baseUrl}/key`);
  assert.equal(keyResponse.status, 200);
  assert.equal(keyResponse.headers.get("cache-control"), "no-store");
  const { key } = await keyResponse.json();
  assert.match(key, /^[A-Za-z0-9_-]{40,}$/);

  const loginResponse = await fetch(`${baseUrl}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseUrl },
    body: JSON.stringify({ key }),
  });
  assert.equal(loginResponse.status, 200);
  const cookie = loginResponse.headers.get("set-cookie").match(/jnet_session=[a-f0-9]+/)[0];
  await assert.rejects(readFile(path.join(dataDir, "key")));

  const removedKey = await fetch(`${baseUrl}/key`);
  assert.equal(removedKey.status, 410);

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
    body: JSON.stringify({ port: 5002 }),
  });
  assert.equal(acceptedWrite.status, 200);
  assert.equal((await acceptedWrite.json()).settings.port, 5002);
});
