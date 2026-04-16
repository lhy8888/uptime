const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("maintenance socket handler checks ownership before modifying or reading maintenance-linked resources", () => {
    const file = path.join(__dirname, "..", "..", "server", "socket-handlers", "maintenance-socket-handler.js");
    const content = fs.readFileSync(file, "utf8");

    assert.match(content, /async function getOwnedMaintenance\(maintenanceID, userID\)/);
    assert.match(content, /await getOwnedMaintenance\(maintenanceID, socket\.userID\);/);
    assert.match(content, /DELETE FROM maintenance WHERE id = \? AND user_id = \? /);
    assert.match(content, /Permission denied\./);
});
