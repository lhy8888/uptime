const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("auth uses per-client scoped limiters and validates API key structure", () => {
    const authFile = path.join(__dirname, "..", "..", "server", "auth.js");
    const content = fs.readFileSync(authFile, "utf8");

    assert.match(content, /getClientRateLimitKey\(req\)/);
    assert.match(content, /loginAttemptRateLimiter\.pass\(rateLimitKey, null, 0\)/);
    assert.match(content, /apiAttemptRateLimiter\.pass\(rateLimitKey, null, 0\)/);
    assert.match(content, /!key\.startsWith\("uk"\) \|\| separatorIndex <= 2 \|\| separatorIndex >= key\.length - 1/);
    assert.match(content, /if \(!\/\^\\d\+\$\/\.test\(index\)\) \{/);
});
