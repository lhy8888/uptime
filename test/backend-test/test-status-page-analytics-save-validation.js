const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("status page save path validates analytics configuration before storing", () => {
    const file = path.join(__dirname, "..", "..", "server", "socket-handlers", "status-page-socket-handler.js");
    const content = fs.readFileSync(file, "utf8");

    assert.match(content, /const analytics = require\("\.\.\/analytics\/analytics"\);/);
    assert.match(content, /statusPage\.analytics_type = config\.analyticsType \?\? null;/);
    assert.match(content, /if \(statusPage\.analytics_type !== null && !analytics\.isValidAnalyticsConfig\(statusPage\)\) \{/);
    assert.match(content, /throw new Error\("Invalid analytics config"\);/);
});
