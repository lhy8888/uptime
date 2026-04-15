const test = require("node:test");
const assert = require("node:assert/strict");
const analytics = require("../../server/analytics/analytics");

test("analytics script URLs for umami/plausible must use http or https", () => {
    assert.equal(
        analytics.isValidAnalyticsConfig({
            analyticsType: "umami",
            analyticsId: "site-1",
            analyticsScriptUrl: "https://analytics.example.com/script.js",
        }),
        true
    );

    assert.equal(
        analytics.isValidAnalyticsConfig({
            analyticsType: "plausible",
            analyticsId: "example.com",
            analyticsScriptUrl: "http://analytics.example.com/js/script.js",
        }),
        true
    );

    assert.equal(
        analytics.isValidAnalyticsConfig({
            analyticsType: "umami",
            analyticsId: "site-1",
            analyticsScriptUrl: "javascript:alert(1)",
        }),
        false
    );

    assert.equal(
        analytics.isValidAnalyticsConfig({
            analyticsType: "plausible",
            analyticsId: "example.com",
            analyticsScriptUrl: "data:text/javascript,alert(1)",
        }),
        false
    );

    assert.equal(
        analytics.isValidAnalyticsConfig({
            analyticsType: "plausible",
            analyticsId: "example.com",
            analyticsScriptUrl: "ftp://analytics.example.com/script.js",
        }),
        false
    );
});
