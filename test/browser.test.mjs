import assert from "node:assert/strict";
import test from "node:test";
import { normalizeBrowserUrl } from "../public/browser.js";

test("browser URLs only allow public HTTP(S) sites outside the Jnet origin", () => {
  assert.equal(normalizeBrowserUrl("example.com", "http://127.0.0.1:8080"), "https://example.com/");
  assert.equal(normalizeBrowserUrl("http://example.com/page", "http://127.0.0.1:8080"), "http://example.com/page");
  for (const address of [
    "javascript:alert(1)",
    "https://user:password@example.com",
    "http://127.0.0.1:8080/admin",
    "https://example.com:8443/",
    "http://localhost/",
    "http://192.168.1.1/",
    "http://[::1]/",
    "http://intranet/",
  ]) {
    assert.throws(() => normalizeBrowserUrl(address, "http://127.0.0.1:8080"));
  }
});
