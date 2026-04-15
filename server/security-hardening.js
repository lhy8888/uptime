const dayjs = require("dayjs");
const jwt = require("jsonwebtoken");
const path = require("path");
const { RateLimiter } = require("limiter");
const { R } = require("redbean-node");
const { log } = require("../src/util");
const Database = require("./database");
const { Settings } = require("./settings");
const { UptimeKumaServer } = require("./uptime-kuma-server");

const SCREENSHOT_TOKEN_PATTERN = /^[A-Za-z0-9._-]+$/;
const MAX_PUSH_MESSAGE_LENGTH = 1024;
const PUSH_TOKENS_PER_INTERVAL = 60;
const MAX_PUSH_LIMITER_ENTRIES = 5000;
const pushRateLimiters = new Map();

/**
 * Get the first forwarded host value.
 * @param {import("http").IncomingHttpHeaders} headers Request headers
 * @returns {string | null} Forwarded host if present
 */
function getForwardedHost(headers) {
    const xForwardedHost = headers["x-forwarded-host"];
    if (typeof xForwardedHost !== "string") {
        return null;
    }

    return xForwardedHost.split(",")[0].trim() || null;
}

/**
 * Normalize push status.
 * @param {unknown} input Status input
 * @returns {string} Normalized status
 */
function normalizePushStatus(input) {
    const status = typeof input === "string" ? input.toLowerCase() : "up";
    if (status !== "up" && status !== "down") {
        throw new Error("Invalid status value. Must be 'up' or 'down'.");
    }
    return status;
}

/**
 * Normalize push message.
 * @param {unknown} input Message input
 * @returns {string} Normalized message
 */
function normalizePushMessage(input) {
    const message = typeof input === "string" ? input : String(input ?? "OK");
    if (message.length > MAX_PUSH_MESSAGE_LENGTH) {
        throw new Error(`Push message is too long. Max length is ${MAX_PUSH_MESSAGE_LENGTH} characters.`);
    }
    return message;
}

/**
 * Build a scoped rate-limit key for push requests.
 * @param {import("express").Request} req Express request
 * @returns {string} Rate-limit key
 */
function buildPushRateLimitKey(req) {
    const clientIP =
        req.ip ||
        req.socket?.remoteAddress ||
        req.connection?.remoteAddress ||
        "";

    return `${req.params.pushToken}:${clientIP.replace(/^::ffff:/, "")}`;
}

/**
 * Keep the in-memory limiter registry bounded.
 * @returns {void}
 */
function prunePushRateLimiters() {
    while (pushRateLimiters.size > MAX_PUSH_LIMITER_ENTRIES) {
        const oldestKey = pushRateLimiters.keys().next().value;
        if (!oldestKey) {
            break;
        }
        pushRateLimiters.delete(oldestKey);
    }
}

/**
 * Get a per-key push rate limiter.
 * @param {string} key Limiter key
 * @returns {RateLimiter} Rate limiter instance
 */
function getPushRateLimiter(key) {
    let entry = pushRateLimiters.get(key);

    if (!entry) {
        entry = {
            limiter: new RateLimiter({
                tokensPerInterval: PUSH_TOKENS_PER_INTERVAL,
                interval: "minute",
                fireImmediately: true,
            }),
        };
        pushRateLimiters.set(key, entry);
        prunePushRateLimiters();
        return entry.limiter;
    }

    pushRateLimiters.delete(key);
    pushRateLimiters.set(key, entry);
    return entry.limiter;
}

/**
 * Issue a short-lived screenshot token.
 * @param {UptimeKumaServer} server Server instance
 * @param {number} monitorID Monitor ID
 * @param {number|string} userID User ID
 * @returns {string} Signed token
 */
function issueScreenshotToken(server, monitorID, userID) {
    return jwt.sign(
        {
            monitorID,
            userID,
            scope: "screenshot",
        },
        server.jwtSecret,
        {
            expiresIn: "5m",
        }
    );
}

/**
 * Install push hardening middleware.
 * @param {import("express").Express} app Express app
 * @returns {void}
 */
function installPushHardening(app) {
    if (app.locals.__pushHardeningInstalled) {
        return;
    }

    app.locals.__pushHardeningInstalled = true;

    app.use("/api/push/:pushToken", async (req, res, next) => {
        try {
            const limiter = getPushRateLimiter(buildPushRateLimitKey(req));
            const remaining = await limiter.removeTokens(1);

            if (remaining < 0) {
                res.status(429).json({
                    ok: false,
                    msg: "Too frequently, try again later.",
                });
                return;
            }

            if (req.query.msg === undefined && req.body?.msg !== undefined) {
                req.query.msg = req.body.msg;
            }
            if (req.query.status === undefined && req.body?.status !== undefined) {
                req.query.status = req.body.status;
            }
            if (req.query.ping === undefined && req.body?.ping !== undefined) {
                req.query.ping = req.body.ping;
            }

            if (req.query.msg !== undefined) {
                req.query.msg = normalizePushMessage(req.query.msg);
            }

            req.query.status = normalizePushStatus(req.query.status ?? "up");
            next();
        } catch (error) {
            res.status(400).json({
                ok: false,
                msg: error.message,
            });
        }
    });
}

/**
 * Install the authenticated screenshot route.
 * @param {import("express").Express} app Express app
 * @param {UptimeKumaServer} server Server instance
 * @returns {void}
 */
function installScreenshotRoute(app, server) {
    if (app.locals.__secureScreenshotRouteInstalled) {
        return;
    }

    app.locals.__secureScreenshotRouteInstalled = true;

    app.get("/screenshots/:token.png", async (req, res) => {
        try {
            const token = req.params.token;
            if (!SCREENSHOT_TOKEN_PATTERN.test(token)) {
                throw new Error("Invalid screenshot token.");
            }

            const decoded = jwt.verify(token, server.jwtSecret);
            if (!decoded || decoded.scope !== "screenshot") {
                throw new Error("Invalid screenshot token.");
            }

            const monitor = await R.findOne("monitor", " id = ? AND user_id = ? ", [
                decoded.monitorID,
                decoded.userID,
            ]);

            if (!monitor) {
                throw new Error("Monitor not found.");
            }

            const filePath = path.resolve(Database.screenshotDir, `${token}.png`);
            res.setHeader("Cache-Control", "private, max-age=60");
            res.sendFile(filePath, (error) => {
                if (error && !res.headersSent) {
                    res.status(error.statusCode || 404).send("File not found.");
                }
            });
        } catch (_) {
            res.status(404).send("File not found.");
        }
    });
}

/**
 * Replace the default websocket origin checker with a safer version.
 * @param {UptimeKumaServer} server Server instance
 * @returns {void}
 */
function patchWebSocketOriginCheck(server) {
    if (!server.io || server.__secureAllowRequestInstalled) {
        return;
    }

    const allowRequest = async (req, callback) => {
        let transport = req._query?.transport;
        if (!transport) {
            log.error("socket", "Ops!!! Cannot get transport type, assume that it is polling");
            transport = "polling";
        }

        const clientIP = await server.getClientIPwithProxy(req.connection.remoteAddress, req.headers);
        log.info("socket", `New ${transport} connection, IP = ${clientIP}`);

        if (transport === "polling") {
            callback(null, true);
            return;
        }

        if (transport !== "websocket") {
            callback(null, false);
            return;
        }

        const bypass = process.env.UPTIME_KUMA_WS_ORIGIN_CHECK === "bypass";
        if (bypass) {
            log.info("auth", "WebSocket origin check is bypassed");
            callback(null, true);
            return;
        }

        if (!req.headers.origin) {
            log.info("auth", "WebSocket with no origin is allowed");
            callback(null, true);
            return;
        }

        try {
            const originURL = new URL(req.headers.origin);
            const allowedHosts = new Set([req.headers.host].filter(Boolean));

            if (await Settings.get("trustProxy")) {
                const forwardedHost = getForwardedHost(req.headers);
                if (forwardedHost) {
                    allowedHosts.add(forwardedHost);
                }
            }

            if (!allowedHosts.has(originURL.host)) {
                callback(null, false);
                log.error(
                    "auth",
                    `Origin (${req.headers.origin}) does not match allowed hosts (${Array.from(allowedHosts).join(", ")}), IP: ${clientIP}`
                );
                return;
            }

            callback(null, true);
        } catch (_) {
            callback(null, false);
            log.error("auth", `Invalid origin url (${req.headers.origin}), IP: ${clientIP}`);
        }
    };

    if (server.io.opts) {
        server.io.opts.allowRequest = allowRequest;
    }
    if (server.io.engine?.opts) {
        server.io.engine.opts.allowRequest = allowRequest;
    }

    server.__secureAllowRequestInstalled = true;
}

if (!UptimeKumaServer.__securityHardeningApplied) {
    UptimeKumaServer.__securityHardeningApplied = true;

    const originalGetInstance = UptimeKumaServer.getInstance;
    UptimeKumaServer.getInstance = function () {
        const instance = originalGetInstance.call(this);
        patchWebSocketOriginCheck(instance);
        return instance;
    };

    const originalGetMonitorJSONList = UptimeKumaServer.prototype.getMonitorJSONList;
    UptimeKumaServer.prototype.getMonitorJSONList = async function (userID, monitorID = null) {
        const result = await originalGetMonitorJSONList.call(this, userID, monitorID);

        for (const monitor of Object.values(result)) {
            if (monitor && monitor.type === "real-browser" && monitor.id && this.jwtSecret) {
                monitor.screenshot = `/screenshots/${issueScreenshotToken(this, monitor.id, userID)}.png`;
            }
        }

        return result;
    };

    UptimeKumaServer.prototype.initAfterDatabaseReady = async function () {
        installPushHardening(this.app);
        installScreenshotRoute(this.app, this);

        process.env.TZ = await this.getTimezone();
        dayjs.tz.setDefault(process.env.TZ);
        log.debug("DEBUG", "Timezone: " + process.env.TZ);
        log.debug("DEBUG", "Current Time: " + dayjs.tz().format());

        await this.loadMaintenanceList();
    };
}

module.exports = {
    getForwardedHost,
    normalizePushMessage,
    normalizePushStatus,
    buildPushRateLimitKey,
    issueScreenshotToken,
};
