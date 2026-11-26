import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createJNetServer } from "../server.mjs";

async function unusedPort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

function zipStored(files) {
  const crc32 = (buffer) => {
    let crc = 0xffffffff;
    for (const byte of buffer) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    return (crc ^ 0xffffffff) >>> 0;
  };
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  for (const [filename, value] of Object.entries(files)) {
    const name = Buffer.from(filename);
    const data = Buffer.from(value);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    localParts.push(local, name, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(central, name);
    localOffset += local.length + name.length + data.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

test("user roles are enforced and administrator reset writes a new one-time setup key", async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "jnet-accounts-test-"));
  const app = await createJNetServer({ dataDir, port: 0 });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${app.server.address().port}`;
  t.after(async () => {
    await new Promise((resolve, reject) => app.server.close((error) => error ? reject(error) : resolve()));
    await rm(dataDir, { recursive: true, force: true });
  });

  assert.equal((await fetch(`${baseUrl}/key`)).status, 404);
  const setupKey = (await readFile(path.join(dataDir, "key"), "utf8")).trim();
  const adminLogin = await fetch(`${baseUrl}/api/setup`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseUrl },
    body: JSON.stringify({ key: setupKey, username: "admin-user", password: "A-long-admin-password" }),
  });
  assert.equal(adminLogin.status, 201);
  const adminCookie = adminLogin.headers.get("set-cookie").match(/jnet_session=[a-f0-9]+/)[0];
  const adminState = await (await fetch(`${baseUrl}/api/status`, { headers: { cookie: adminCookie } })).json();
  assert.equal(adminState.chatBackendModule.port, 8091);
  assert.equal(adminState.chatBackendModule.path, "/api/chat");
  const adminWrite = async (url, method, body) => fetch(`${baseUrl}${url}`, {
    method,
    headers: {
      "content-type": "application/json",
      origin: baseUrl,
      cookie: adminCookie,
      "x-jnet-csrf": adminState.csrfToken,
    },
    body: JSON.stringify(body),
  });

  const serverPortCollision = await adminWrite("/api/server-settings", "POST", { port: 8090 });
  assert.equal(serverPortCollision.status, 400);
  const serverPortUpdate = await adminWrite("/api/server-settings", "POST", { port: 8082 });
  assert.equal(serverPortUpdate.status, 200);
  assert.deepEqual((await serverPortUpdate.json()).settings, {
    serverPort: 8082,
    restartRequired: true,
    environmentOverride: Boolean(process.env.PORT),
  });

  const created = await adminWrite("/api/users", "POST", {
    username: "normal-user",
    password: "A-long-password-123",
    roleId: "normal",
  });
  assert.equal(created.status, 201);
  const user = (await created.json()).user;
  assert.equal("hash" in user, false);

  const userLogin = await fetch(`${baseUrl}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseUrl },
    body: JSON.stringify({ username: "normal-user", password: "A-long-password-123" }),
  });
  assert.equal(userLogin.status, 200);
  const userCookie = userLogin.headers.get("set-cookie").match(/jnet_session=[a-f0-9]+/)[0];
  const userState = await (await fetch(`${baseUrl}/api/status`, { headers: { cookie: userCookie } })).json();
  assert.equal(userState.role.name, "Normal");
  assert.equal(userState.permissions.includes("*"), false);
  assert.equal(adminState.storageBackendModule.enabled, false);
  assert.equal(adminState.configuredServerPort, Number(process.env.PORT || 8080));
  assert.equal((await fetch(`${baseUrl}/api/storage/files`, { headers: { cookie: userCookie } })).status, 403);

  const deniedUsers = await fetch(`${baseUrl}/api/users`, { headers: { cookie: userCookie } });
  assert.equal(deniedUsers.status, 403);
  const deniedModuleStart = await fetch(`${baseUrl}/api/modules/wisp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: baseUrl,
      cookie: userCookie,
      "x-jnet-csrf": userState.csrfToken,
    },
    body: JSON.stringify({ action: "start" }),
  });
  assert.equal(deniedModuleStart.status, 403);

  const elevationAttempt = await fetch(`${baseUrl}/api/users/${user.id}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      origin: baseUrl,
      cookie: userCookie,
      "x-jnet-csrf": userState.csrfToken,
    },
    body: JSON.stringify({ roleId: "elevated" }),
  });
  assert.equal(elevationAttempt.status, 403);

  assert.equal((await adminWrite("/api/platform", "PATCH", { selfSignup: true })).status, 200);
  const signUp = await fetch(`${baseUrl}/api/signup`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseUrl },
    body: JSON.stringify({ username: "new-signup", password: "Another-long-password-123" }),
  });
  assert.equal(signUp.status, 201);
  const signedUpState = await signUp.json();
  assert.equal(signedUpState.role.name, "Normal");
  const signedUpCookie = signUp.headers.get("set-cookie").match(/jnet_session=[a-f0-9]+/)[0];

  const enableChat = await adminWrite("/api/apps", "PATCH", {
    apps: [
      { id: "browser", enabled: true, public: true },
      { id: "wisp-browser", enabled: true, public: true },
      { id: "chat", enabled: true, public: true },
      { id: "storage", enabled: true, public: true },
      { id: "connect", enabled: true, public: true },
    ],
  });
  assert.equal(enableChat.status, 200);
  const deniedModuleEvents = await fetch(`${baseUrl}/api/modules/events`, {
    headers: { cookie: userCookie },
  });
  assert.equal(deniedModuleEvents.status, 403);
  const moduleEvents = await fetch(`${baseUrl}/api/modules/events`, {
    headers: { cookie: adminCookie },
  });
  assert.equal(moduleEvents.headers.get("content-type"), "text/event-stream; charset=utf-8");
  const moduleEventReader = moduleEvents.body.getReader();
  const eventDecoder = new TextDecoder();
  const readModuleEvent = async () => {
    let event = "";
    while (!event.includes("\n\n")) {
      const { done, value } = await moduleEventReader.read();
      assert.equal(done, false);
      event += eventDecoder.decode(value, { stream: true });
    }
    return JSON.parse(event.match(/^data: (.+)$/m)[1]);
  };
  assert.equal((await readModuleEvent()).storageBackendModule.status, "running");
  assert.equal((await adminWrite("/api/modules/storage-backend", "POST", { action: "disable" })).status, 200);
  assert.equal((await readModuleEvent()).storageBackendModule.status, "disabled");
  assert.equal((await adminWrite("/api/modules/storage-backend", "POST", { action: "enable" })).status, 200);
  assert.equal((await readModuleEvent()).storageBackendModule.status, "running");
  await moduleEventReader.cancel();
  const visibleApps = await fetch(`${baseUrl}/api/apps`, { headers: { cookie: userCookie } });
  assert.equal((await visibleApps.json()).apps.some((item) => item.id === "storage"), true);
  const friendRequest = await fetch(`${baseUrl}/api/connect/friends`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: baseUrl,
      cookie: userCookie,
      "x-jnet-csrf": userState.csrfToken,
    },
    body: JSON.stringify({ username: "new-signup" }),
  });
  assert.equal(friendRequest.status, 201);
  const friendshipId = (await friendRequest.json()).friendship.id;
  const acceptRequest = await fetch(`${baseUrl}/api/connect/friends/${friendshipId}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      origin: baseUrl,
      cookie: signedUpCookie,
      "x-jnet-csrf": signedUpState.csrfToken,
    },
    body: JSON.stringify({ accept: true }),
  });
  assert.equal(acceptRequest.status, 200);
  const chatPort = await unusedPort();
  const chatSettings = await adminWrite("/api/modules/chat-backend", "POST", {
    action: "configure",
    port: chatPort,
    path: "/api/chat",
  });
  assert.equal(chatSettings.status, 200, await chatSettings.text());
  const storageUpload = await fetch(`${baseUrl}/api/storage/upload?path=docs%2Fhello.md`, {
    method: "POST",
    headers: {
      "content-type": "application/octet-stream",
      origin: baseUrl,
      cookie: userCookie,
      "x-jnet-csrf": userState.csrfToken,
    },
    body: "# Hello from Storage",
  });
  assert.equal(storageUpload.status, 201);
  const connectSend = await fetch(`${baseUrl}/api/connect/send`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: baseUrl,
      cookie: userCookie,
      "x-jnet-csrf": userState.csrfToken,
    },
    body: JSON.stringify({ toUserId: signedUpState.user.id, path: "docs/hello.md" }),
  });
  assert.equal(connectSend.status, 201);
  const receivedPath = (await connectSend.json()).path;
  const receivedFile = await fetch(`${baseUrl}/api/storage/file?path=${encodeURIComponent(receivedPath)}`, {
    headers: { cookie: signedUpCookie },
  });
  assert.equal(receivedFile.status, 200);
  assert.equal((await receivedFile.json()).content, "# Hello from Storage");
  assert.equal((await fetch(`${baseUrl}/api/storage/file?path=docs%2Fhello.md`, {
    headers: { cookie: signedUpCookie },
  })).status, 404);
  const installedChatModule = await adminWrite("/api/modules/chat-backend", "POST", { action: "download" });
  assert.equal(installedChatModule.status, 200);
  assert.equal((await installedChatModule.json()).chatBackendModule.installed, true);
  const startedChatModule = await adminWrite("/api/modules/chat-backend", "POST", { action: "start" });
  assert.equal(startedChatModule.status, 200);
  assert.equal((await startedChatModule.json()).chatBackendModule.status, "running");
  const chatUsersResponse = await fetch(`${baseUrl}/api/chat/users`, { headers: { cookie: userCookie } });
  assert.equal(chatUsersResponse.status, 200);
  const chatUsers = (await chatUsersResponse.json()).users;
  const recipient = chatUsers.find((item) => item.username === "new-signup");
  const conversationResponse = await fetch(`${baseUrl}/api/chat/conversations`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: baseUrl,
      cookie: userCookie,
      "x-jnet-csrf": userState.csrfToken,
    },
    body: JSON.stringify({ members: [recipient.id] }),
  });
  assert.equal(conversationResponse.status, 201);
  const { conversation } = await conversationResponse.json();
  const sentMessage = await fetch(`${baseUrl}/api/chat/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: baseUrl,
      cookie: userCookie,
      "x-jnet-csrf": userState.csrfToken,
    },
    body: JSON.stringify({ conversationId: conversation.id, text: "<script>alert(1)</script>" }),
  });
  assert.equal(sentMessage.status, 201);
  const messageList = await fetch(`${baseUrl}/api/chat/messages?conversation=${conversation.id}`, {
    headers: { cookie: signedUpCookie },
  });
  assert.equal(messageList.status, 200);
  assert.equal((await messageList.json()).messages[0].text, "<script>alert(1)</script>");
  const nonMemberRead = await fetch(`${baseUrl}/api/chat/messages?conversation=${conversation.id}`, {
    headers: { cookie: adminCookie },
  });
  assert.equal(nonMemberRead.status, 404);

  const tld = await adminWrite("/api/domains", "POST", { type: "tld", name: "local" });
  assert.equal(tld.status, 201);
  const domain = await adminWrite("/api/domains", "POST", { type: "domain", name: "example", tld: "local" });
  assert.equal(domain.status, 201);
  const domainId = (await domain.json()).domains[0].id;
  const subdomain = await adminWrite("/api/domains", "POST", { type: "subdomain", name: "www", parentId: domainId });
  assert.equal(subdomain.status, 201);
  const subdomainId = (await subdomain.json()).domains[1].id;
  const uploadedSite = await fetch(
    `${baseUrl}/api/sites/upload?domainId=${subdomainId}&title=Secure%20site`,
    {
      method: "POST",
      headers: {
        "content-type": "application/zip",
        origin: baseUrl,
        cookie: adminCookie,
        "x-jnet-csrf": adminState.csrfToken,
      },
      body: zipStored({
        "index.html": '<!doctype html><script>window.jnetEscaped=true</script><h1>safe preview</h1>',
        "assets/site.js": "window.jnetEscaped=false",
      }),
    },
  );
  assert.equal(uploadedSite.status, 201);
  const site = (await uploadedSite.json()).site;
  const siteFiles = await fetch(`${baseUrl}/api/sites/${site.id}/files`, { headers: { cookie: adminCookie } });
  assert.equal(siteFiles.status, 200);
  assert.equal((await siteFiles.json()).files.length, 2);
  const servedSite = await fetch(`${baseUrl}/site/${site.id}/index.html`);
  assert.equal(servedSite.status, 200);
  assert.match(servedSite.headers.get("content-security-policy"), /script-src 'none'/);
  assert.match(await servedSite.text(), /window\.jnetEscaped=true/);
  const servedScript = await fetch(`${baseUrl}/site/${site.id}/assets/site.js`);
  assert.match(servedScript.headers.get("content-security-policy"), /script-src 'none'/);
  assert.equal((await fetch(`${baseUrl}/site-editor/${site.id}`)).status, 200);
  const badArchive = await fetch(
    `${baseUrl}/api/sites/upload?domainId=${subdomainId}&title=Bad%20site`,
    {
      method: "POST",
      headers: {
        "content-type": "application/zip",
        origin: baseUrl,
        cookie: adminCookie,
        "x-jnet-csrf": adminState.csrfToken,
      },
      body: zipStored({ "index.html": "<h1>x</h1>", "../outside.txt": "no" }),
    },
  );
  assert.equal(badArchive.status, 400);
  assert.equal((await adminWrite("/api/modules/chat-backend", "POST", { action: "stop" })).status, 200);
  const configureChatUrl = await adminWrite("/api/apps", "PATCH", {
    apps: [
      { id: "browser", enabled: true, public: true },
      { id: "wisp-browser", enabled: true, public: true },
      { id: "chat", enabled: true, public: true },
      { id: "storage", enabled: true, public: true },
      { id: "connect", enabled: true, public: true },
    ],
    chatSettings: { domainId: subdomainId, path: "/chat", backendPath: "/api/chat/v2" },
  });
  assert.equal(configureChatUrl.status, 200);
  assert.equal((await adminWrite("/api/modules/chat-backend", "POST", { action: "start" })).status, 200);
  assert.equal((await fetch(`${baseUrl}/domain/www.example.local/chat`)).status, 200);
  assert.equal((await fetch(`${baseUrl}/api/chat/v2/users`, { headers: { cookie: adminCookie } })).status, 200);
  assert.equal((await fetch(`${baseUrl}/api/chat/users`, { headers: { cookie: adminCookie } })).status, 404);
  const hosted = await adminWrite("/api/hosting", "POST", {
    domainId: subdomainId,
    title: "Test page",
    content: "<script>alert(1)</script>",
  });
  assert.equal(hosted.status, 201);
  const hostedId = (await hosted.json()).host.id;
  const hostedPage = await fetch(`${baseUrl}/site/${hostedId}`);
  assert.equal(hostedPage.status, 200);
  assert.match(await hostedPage.text(), /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(hostedPage.headers.get("content-security-policy"), /default-src 'none'/);
  const namedHostedPage = await fetch(`${baseUrl}/domain/www.example.local`);
  assert.equal(namedHostedPage.status, 200);
  assert.equal((await fetch(`${baseUrl}/api/hosted`, { headers: { cookie: userCookie } })).status, 200);

  const deniedHostWrite = await fetch(`${baseUrl}/api/hosting`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: baseUrl,
      cookie: userCookie,
      "x-jnet-csrf": userState.csrfToken,
    },
    body: JSON.stringify({ domainId: subdomainId, title: "No", content: "No" }),
  });
  assert.equal(deniedHostWrite.status, 403);

  const announcementWrite = await adminWrite("/api/announcement", "PUT", {
    enabled: true,
    text: "Hello <script>alert(1)</script>",
    color: "#123abc",
    image: "",
  });
  assert.equal(announcementWrite.status, 200);
  assert.equal((await (await fetch(`${baseUrl}/api/public`)).json()).announcement.text, "Hello <script>alert(1)</script>");
  const announcementCss = await fetch(`${baseUrl}/announcement.css`);
  assert.equal(announcementCss.status, 200);
  assert.equal(announcementCss.headers.get("content-type"), "text/css; charset=utf-8");
  assert.match(await announcementCss.text(), /background-color:#123abc/);
  const deniedAnnouncementWrite = await fetch(`${baseUrl}/api/announcement`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      origin: baseUrl,
      cookie: userCookie,
      "x-jnet-csrf": userState.csrfToken,
    },
    body: JSON.stringify({ enabled: false }),
  });
  assert.equal(deniedAnnouncementWrite.status, 403);

  const deletedDomain = await adminWrite("/api/domains", "DELETE", { id: domainId });
  assert.equal(deletedDomain.status, 200);
  const afterDomainDeletion = await (await fetch(`${baseUrl}/api/status`, { headers: { cookie: adminCookie } })).json();
  assert.equal(afterDomainDeletion.chatSettings.domainId, null);
  assert.equal((await fetch(`${baseUrl}/domain/www.example.local`)).status, 404);
  assert.equal((await adminWrite("/api/domains", "DELETE", { tld: "local" })).status, 200);

  const role = await adminWrite("/api/roles", "POST", {
    name: "Domain Readers",
    permissions: ["domains:view"],
  });
  assert.equal(role.status, 201);

  const rotate = await adminWrite("/api/key", "POST", {});
  assert.equal(rotate.status, 200);
  assert.equal(rotate.headers.get("set-cookie").includes("Max-Age=0"), true);
  const rotationResult = await rotate.json();
  assert.equal(rotationResult.ok, true);
  assert.equal("key" in rotationResult, false);
  const replacementKey = (await readFile(path.join(dataDir, "key"), "utf8")).trim();
  assert.match(replacementKey, /^[A-Za-z0-9_-]{40,}$/);
  assert.notEqual(replacementKey, setupKey);
  assert.equal((await stat(path.join(dataDir, "key"))).mode & 0o777, 0o600);
  assert.equal((await readFile(path.join(dataDir, "key"), "utf8")).trim(), replacementKey);
  assert.equal((await (await fetch(`${baseUrl}/api/status`, { headers: { cookie: adminCookie } })).json()).authenticated, false);
  const resetStatus = await (await fetch(`${baseUrl}/api/status`)).json();
  assert.equal(resetStatus.initialized, true);
  assert.equal(resetStatus.setupAvailable, true);

  const oldKeyLogin = await fetch(`${baseUrl}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseUrl },
    body: JSON.stringify({ key: setupKey }),
  });
  assert.equal(oldKeyLogin.status, 401);
});
