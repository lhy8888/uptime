const test = require("node:test");
const assert = require("node:assert/strict");
const StatusPage = require("../../server/model/status_page");

test("status page forwarded header sanitizers only accept safe values", () => {
    assert.equal(StatusPage.sanitizeForwardedProto("http",", "http");
    assert.equal(StatusPage.sanitizeForwardedProto("https,  http"), "https");
    assert.equal(StatusPage.sanitizeForwardedProto("ftp"), null);
    assert.equal(StatusPage.sanitizeForwardedProto("javascript"), null);

    assert.equal(StatusPage.sanitizeForwardedHost("status.example.com"), "status.example.com");
    assert.equal(StatusPage.sanitizeForwardedHost("status.example.com:443, proxy.example.com"), "status.example.com:443");
    assert.equal(StatusPage.sanitizeForwardedHost("evil.example.com/path"), null);
    assert.equal(StatusPage.sanitizeForwardedHost("evil example.com"), null);
    assert.equal(StatusPage.sanitizeForwardedHost("evil@example.com"), null);
});
