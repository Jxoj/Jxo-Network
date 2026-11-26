import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

const MAX_MESSAGES = 20_000;

export async function createChatBackend(dataDirectory) {
  const directory = path.resolve(dataDirectory);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, "chat.json");
  let state;
  try {
    state = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    state = { conversations: [], messages: [] };
    await writeFile(file, `${JSON.stringify(state)}\n`, { mode: 0o600, flag: "wx" });
  }
  if (
    !state ||
    !Array.isArray(state.conversations) ||
    !Array.isArray(state.messages) ||
    state.messages.length > MAX_MESSAGES ||
    state.conversations.length > 10_000
  ) {
    throw new Error("The chat backend data is invalid.");
  }
  const conversations = new Map();
  for (const conversation of state.conversations) {
    if (
      !conversation ||
      typeof conversation.id !== "string" ||
      !/^[a-f0-9]{32}$/.test(conversation.id) ||
      conversations.has(conversation.id) ||
      !["direct", "group"].includes(conversation.type) ||
      !Array.isArray(conversation.members) ||
      conversation.members.length < 1 ||
      conversation.members.length > 20 ||
      conversation.members.some((member) => typeof member !== "string" || (!/^[a-f0-9]{32}$/.test(member) && member !== "admin-key")) ||
      new Set(conversation.members).size !== conversation.members.length ||
      typeof conversation.title !== "string" ||
      conversation.title.length > 64 ||
      typeof conversation.createdBy !== "string" ||
      typeof conversation.createdAt !== "string"
    ) {
      throw new Error("The chat backend conversation data is invalid.");
    }
    conversations.set(conversation.id, conversation);
  }
  const messageIds = new Set();
  for (const message of state.messages) {
    const conversation = message && conversations.get(message.conversationId);
    if (
      !message ||
      typeof message.id !== "string" ||
      !/^[a-f0-9]{32}$/.test(message.id) ||
      messageIds.has(message.id) ||
      !conversation?.members.includes(message.senderId) ||
      typeof message.text !== "string" ||
      !message.text.length ||
      message.text.length > 2000 ||
      typeof message.createdAt !== "string"
    ) {
      throw new Error("The chat backend message data is invalid.");
    }
    messageIds.add(message.id);
  }
  await chmod(file, 0o600);

  let queue = Promise.resolve();
  return {
    snapshot() {
      return structuredClone(state);
    },
    update(mutator) {
      const operation = queue.then(async () => {
        const next = mutator(structuredClone(state));
        if (
          !next ||
          !Array.isArray(next.conversations) ||
          !Array.isArray(next.messages) ||
          next.messages.length > MAX_MESSAGES ||
          next.conversations.length > 10_000
        ) {
          throw new Error("The chat backend data limit has been reached.");
        }
        const validConversations = new Map();
        for (const conversation of next.conversations) {
          if (
            !conversation ||
            typeof conversation.id !== "string" ||
            !/^[a-f0-9]{32}$/.test(conversation.id) ||
            validConversations.has(conversation.id) ||
            !["direct", "group"].includes(conversation.type) ||
            !Array.isArray(conversation.members) ||
            conversation.members.length < 1 ||
            conversation.members.length > 20 ||
            new Set(conversation.members).size !== conversation.members.length
          ) throw new Error("The chat conversation is invalid.");
          validConversations.set(conversation.id, conversation);
        }
        for (const message of next.messages) {
          if (
            !message ||
            !validConversations.get(message.conversationId)?.members.includes(message.senderId) ||
            typeof message.text !== "string" ||
            !message.text.length ||
            message.text.length > 2000
          ) throw new Error("The chat message is invalid.");
        }
        const temporary = `${file}.${randomBytes(6).toString("hex")}.tmp`;
        await writeFile(temporary, `${JSON.stringify(next)}\n`, { mode: 0o600 });
        await rename(temporary, file);
        await chmod(file, 0o600);
        state = next;
        return structuredClone(state);
      });
      queue = operation.catch(() => {});
      return operation;
    },
  };
}

async function handleOperation(action, requestBody, chat) {
  const { identity, users, body } = requestBody;
  if (
    !identity ||
    typeof identity.id !== "string" ||
    !/^[a-f0-9]{32}$/.test(identity.id) ||
    !Array.isArray(users) ||
    users.some((user) => !user || typeof user.id !== "string" || !/^[a-f0-9]{32}$/.test(user.id))
  ) {
    throw Object.assign(new Error("Chat identity is invalid."), { status: 400 });
  }
  if (action === "users") return { status: 200, value: { users } };
  if (action === "conversations") {
    if (requestBody.method === "GET") {
      const state = chat.snapshot();
      const conversations = state.conversations
        .filter((item) => item.members.includes(identity.id))
        .map((item) => {
          const lastMessage = state.messages.findLast((message) => message.conversationId === item.id);
          return { ...item, lastMessage: lastMessage ? { text: lastMessage.text, createdAt: lastMessage.createdAt } : null };
        });
      return { status: 200, value: { conversations } };
    }
    if (!Array.isArray(body?.members) || !body.members.length || body.members.length > 19) {
      throw Object.assign(new Error("Choose one to 19 other chat members."), { status: 400 });
    }
    const availableIds = users.map((user) => user.id);
    const members = [...new Set([identity.id, ...body.members])];
    if (
      members.length !== body.members.length + 1 ||
      body.members.some((member) => typeof member !== "string" || !availableIds.includes(member))
    ) {
      throw Object.assign(new Error("One or more selected chat members are unavailable."), { status: 400 });
    }
    const type = members.length > 2 ? "group" : "direct";
    const title = type === "group" ? String(body.title || "").trim().slice(0, 64) : "";
    if (type === "group" && !title) throw Object.assign(new Error("Group conversations need a name."), { status: 400 });
    const next = await chat.update((current) => {
      if (type === "direct") {
        const existing = current.conversations.find((conversation) =>
          conversation.type === "direct" &&
          conversation.members.length === 2 &&
          members.every((member) => conversation.members.includes(member)));
        if (existing) return current;
      }
      current.conversations.push({
        id: randomBytes(16).toString("hex"),
        type,
        title,
        members,
        createdBy: identity.id,
        createdAt: new Date().toISOString(),
      });
      return current;
    });
    const conversation = next.conversations.find((item) =>
      item.type === type &&
      item.members.length === members.length &&
      members.every((member) => item.members.includes(member)) &&
      (type !== "group" || item.title === title));
    return { status: 201, value: { conversation } };
  }
  if (action === "messages" && requestBody.method === "GET") {
    const conversationId = requestBody.query?.conversation;
    const state = chat.snapshot();
    const conversation = state.conversations.find((item) => item.id === conversationId);
    if (!conversation || !conversation.members.includes(identity.id)) {
      throw Object.assign(new Error("Conversation not found."), { status: 404 });
    }
    return {
      status: 200,
      value: { messages: state.messages.filter((message) => message.conversationId === conversation.id).slice(-200) },
    };
  }
  if (action === "messages" && requestBody.method === "POST") {
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    if (!/^[a-f0-9]{32}$/.test(body?.conversationId || "") || !text || text.length > 2000) {
      throw Object.assign(new Error("Messages must contain 1 to 2000 characters."), { status: 400 });
    }
    let message;
    await chat.update((state) => {
      const conversation = state.conversations.find((item) => item.id === body.conversationId);
      if (!conversation || !conversation.members.includes(identity.id)) {
        throw Object.assign(new Error("Conversation not found."), { status: 404 });
      }
      message = {
        id: randomBytes(16).toString("hex"),
        conversationId: conversation.id,
        senderId: identity.id,
        text,
        createdAt: new Date().toISOString(),
      };
      state.messages.push(message);
      return state;
    });
    return { status: 201, value: { message } };
  }
  throw Object.assign(new Error("Chat operation not found."), { status: 404 });
}

export async function startChatBackend({ dataDirectory, host, port, path: routePath, token }) {
  if (!/^[a-f0-9]{64}$/.test(token || "")) throw new Error("Chat backend internal token is invalid.");
  const chat = await createChatBackend(dataDirectory);
  const server = createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    const requestUrl = new URL(req.url || "/", "http://localhost");
    if (req.method === "GET" && requestUrl.pathname === `${routePath}/health`) {
      res.writeHead(200);
      return res.end(JSON.stringify({ status: "ok" }));
    }
    if (req.method !== "POST" || requestUrl.pathname !== `${routePath}/internal`) {
      res.writeHead(404);
      return res.end(JSON.stringify({ error: "Not found." }));
    }
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 300_000) {
        res.writeHead(413);
        return res.end(JSON.stringify({ error: "Internal request is too large." }));
      }
      chunks.push(chunk);
    }
    const raw = Buffer.concat(chunks);
    const signature = req.headers["x-jnet-module-signature"];
    if (typeof signature !== "string" || !/^[a-f0-9]{64}$/.test(signature)) {
      res.writeHead(403);
      return res.end(JSON.stringify({ error: "Request verification failed." }));
    }
    const expected = createHmac("sha256", token).update(raw).digest();
    const supplied = Buffer.from(signature, "hex");
    if (!timingSafeEqual(expected, supplied)) {
      res.writeHead(403);
      return res.end(JSON.stringify({ error: "Request verification failed." }));
    }
    try {
      const requestBody = JSON.parse(raw.toString("utf8"));
      const result = await handleOperation(requestBody.action, requestBody, chat);
      res.writeHead(result.status);
      return res.end(JSON.stringify(result.value));
    } catch (error) {
      res.writeHead(error.status || 400);
      return res.end(JSON.stringify({ error: error.status ? error.message : "The chat request could not be completed." }));
    }
  });
  server.listen(port, host, () => {
    process.stdout.write(`Chat backend listening on ${host}:${port}${routePath}\n`);
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { values } = parseArgs({
    options: {
      host: { type: "string", default: "127.0.0.1" },
      port: { type: "string", default: "8091" },
      path: { type: "string", default: "/api/chat" },
    },
  });
  const server = await startChatBackend({
    dataDirectory: process.env.JNET_MODULE_DATA_DIR || process.cwd(),
    host: values.host,
    port: Number(values.port),
    path: values.path,
    token: process.env.JNET_MODULE_TOKEN,
  });
  const shutdown = () => server.close();
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
