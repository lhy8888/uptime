const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("security hardening module protects screenshots, websocket origin checks, and push route", () => {
    const hardeningFile = path.join(__dirname, "..", "..", "server", "security-hardening.js");
    const browserTypeFile = path.join(
        __dirname,
        "..",
        "..",
        "server",
        "monitor-types",
        "real-browser-monitor-type.js"
    );

    const hardeningContent = fs.readFileSync(hardeningFile, "utf8");
    const browserTypeContent = fs.readFileSync(browserTypeFile, "utf8");

    assert.match(hardeningContent, /expiresIn:\s*"5m"/);
    assert.match(hardeningContent, /scope:\s*"screenshot"/);
    assert.match(hardeningContent, /Cache-Control",\s*"private, max-age=60"/);
    assert.match(hardeningContent, /MAX_PUSH_MESSAGE_LENGTH\s*=\s*1024/);
    assert.match(hardeningContent, /status\(429\)/);
    assert.match(hardeningContent, /x-forwarded-host/);
    assert.match(browserTypeContent, /require\("\.\.\/security-hardening"\)/);
});
