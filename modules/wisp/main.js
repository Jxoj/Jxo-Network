import http from "node:http";
import { parseArgs } from "node:util";
import { server as wisp, logging } from "@mercuryworkshop/wisp-js/server";

const { options } = wisp;
options.allow_private_ips = false;
options.allow_loopback_ips = false;
options.port_whitelist = [80, 443];
options.allow_udp_streams = false;
options.stream_limit_total = 64;
options.stream_limit_per_host = 8;

const { values } = parseArgs({
  options: {
    host: { type: "string", default: "127.0.0.1" },
    port: { type: "string", default: "8090" },
    path: { type: "string", default: "/wisp/v1/connection" },
    logging: { type: "string", default: "INFO" },
  },
});
const routePath = values.path;
if (!routePath.startsWith("/") || routePath.includes("?") || routePath.includes("#")) {
  throw new Error("Wisp path must be an absolute URL path.");
}
const logLevel = values.logging.toUpperCase();
if (typeof logging[logLevel] !== "number") {
  throw new Error("Logging must be DEBUG, INFO, WARN, ERROR, or NONE.");
}
logging.set_level(logging[logLevel]);

const server = http.createServer((req, res) => {
  const requestPath = new URL(req.url || "/", "http://localhost").pathname;
  if (requestPath !== routePath) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("404 not found");
    return;
  }
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Wisp server is running");
});
server.on("upgrade", (req, socket, head) => {
  const requestPath = new URL(req.url || "/", "http://localhost").pathname;
  if (requestPath !== routePath) {
    socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  wisp.routeRequest(req, socket, head);
});
server.on("listening", () => {
  logging.info(`Wisp server listening on ${values.host}:${values.port}${routePath}`);
});
server.listen(Number(values.port), values.host);
