import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createJNetServer } from "../server.mjs";

test("first-run setup consumes the local key and creates an Elevated account", async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "jnet-setup-test-"));
  const app = await createJNetServer({ dataDir, port: 0 });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${app.server.address().port}`;
  t.after(async () => {
    await new Promise((resolve, reject) => app.server.close((error) => error ? reject(error) : resolve()));
    await rm(dataDir, { recursive: true, force: true });
  });

  const status = await (await fetch(`${baseUrl}/api/status`)).json();
  assert.equal(status.initialized, false);
  assert.equal(status.setupAvailable, true);

  const authModule = await fetch(`${baseUrl}/assets/auth.js`);
  assert.equal(authModule.status, 200);
  const authSource = await authModule.text();
  assert.match(authSource, /New to Jnet\? Create an account/);
  assert.doesNotMatch(authSource, /Sign in with key|Administrator key sign-in/);
  const adminPage = await fetch(`${baseUrl}/admin`);
  assert.equal(adminPage.status, 200);
  assert.match(await adminPage.text(), /type="module"/);

  assert.equal((await fetch(`${baseUrl}/key`)).status, 404);
  const key = (await readFile(path.join(dataDir, "key"), "utf8")).trim();
  assert.equal((await stat(path.join(dataDir, "key"))).mode & 0o777, 0o600);

  const rejectedOrigin = await fetch(`${baseUrl}/api/setup`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://attacker.invalid" },
    body: JSON.stringify({ key, username: "owner", password: "A-long-test-password-1" }),
  });
  assert.equal(rejectedOrigin.status, 403);

  const shortPassword = await fetch(`${baseUrl}/api/setup`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseUrl },
    body: JSON.stringify({ key, username: "owner", password: "Short77" }),
  });
  assert.equal(shortPassword.status, 400);

  const setup = await fetch(`${baseUrl}/api/setup`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseUrl },
    body: JSON.stringify({ key, username: "owner", password: "LongPass" }),
  });
  assert.equal(setup.status, 201);
  const setupStatus = await setup.json();
  assert.equal(setupStatus.authenticated, true);
  assert.equal(setupStatus.user.username, "owner");
  assert.equal(setupStatus.role.name, "Elevated");
  assert.deepEqual(setupStatus.permissions, ["*"]);
  await assert.rejects(readFile(path.join(dataDir, "key")));
  const initializedStatus = await (await fetch(`${baseUrl}/api/status`)).json();
  assert.equal(initializedStatus.initialized, true);
  assert.equal(initializedStatus.setupAvailable, false);

  const repeat = await fetch(`${baseUrl}/api/setup`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseUrl },
    body: JSON.stringify({ key, username: "owner", password: "LongPass" }),
  });
  assert.equal(repeat.status, 409);

  const keyLogin = await fetch(`${baseUrl}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseUrl },
    body: JSON.stringify({ key }),
  });
  assert.equal(keyLogin.status, 401);

  const login = await fetch(`${baseUrl}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseUrl },
    body: JSON.stringify({ username: "owner", password: "LongPass" }),
  });
  assert.equal(login.status, 200);
});
