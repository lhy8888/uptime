const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("api key socket handler scopes enable and disable operations to the owning user", () => {
    const file = path.join(__dirname, "..", "..", "server", "socket-handlers", "api-key-socket-handler.js");
    const content = fs.readFileSync(file, "utf8");

    assert.match(content, /DELETE FROM api_key WHERE id = \? AND user_id = \? /);
    assert.match(content, /UPDATE api_key SET active = 0 WHERE id = \? AND user_id = \? /);
    assert.match(content, /UPDATE api_key SET active = 1 WHERE id = \? AND user_id = \? /);
    assert.doesNotMatch(content, /log\.debug\("apikeys", key\);/);
});
