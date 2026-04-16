const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("docker and remote browser delete operations only detach monitors for the owning user", () => {
    const dockerFile = path.join(__dirname, "..", "..", "server", "docker.js");
    const remoteBrowserFile = path.join(__dirname, "..", "..", "server", "remote-browser.js");

    const dockerContent = fs.readFileSync(dockerFile, "utf8");
    const remoteBrowserContent = fs.readFileSync(remoteBrowserFile, "utf8");

    assert.match(dockerContent, /UPDATE monitor SET docker_host = null WHERE docker_host = \? AND user_id = \?/);
    assert.match(remoteBrowserContent, /UPDATE monitor SET remote_browser = null WHERE remote_browser = \? AND user_id = \?/);
});
