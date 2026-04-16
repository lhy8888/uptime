const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("proxy persistence scopes default and delete operations to the owning user", () => {
    const file = path.join(__dirname, "..", "..", "server", "proxy.js");
    const content = fs.readFileSync(file, "utf8");

    assert.match(content, /UPDATE proxy SET `default` = 0 WHERE `default` = 1 AND user_id = \?/);
    assert.match(content, /UPDATE monitor SET proxy_id = null WHERE proxy_id = \? AND user_id = \?/);
    assert.match(content, /bean\.active = proxy\.active !== undefined \? proxy\.active : true;/);
});
