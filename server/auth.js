const basicAuth = require("express-basic-auth");
const passwordHash = require("./password-hash");
const { R } = require("redbean-node");
const { log } = require("../src/util");
const { loginAttemptRateLimiter, apiAttemptRateLimiter } = require("./rate-limiter");
const { Settings } = require("./settings");
const dayjs = require("dayjs");

/**
 * Login to web app
 * @param {string} username Username to login with
 * @param {string} password Password to login with
 * @returns {Promise<(Bean|null)>} User or null if login failed
 */
exports.login = async function (username, password) {
    if (typeof username !== "string" || typeof password !== "string") {
        return null;
    }

    let user = await R.findOne("user", "TRIM(username) = ? AND active = 1 ", [username.trim()]);

    if (user && passwordHash.verify(password, user.password)) {
        // Upgrade the hash to bcrypt
        if (passwordHash.needRehash(user.password)) {
            await R.exec("UPDATE `user` SET password = ? WHERE id = ? ", [
                await passwordHash.generate(password),
                user.id,
            ]);
        }
        return user;
    }

    return null;
};

/**
 * Get a stable per-client rate-limit key.
 * @param {express.Request} req Express request object
 * @returns {string} Rate-limit key
 */
function getClientRateLimitKey(req) {
    return (req.ip || req.socket?.remoteAddress || req.connection?.remoteAddress || "unknown").replace(/^::ffff:/, "");
}

/**
 * Validate a provided API key
 * @param {string} key API key to verify
 * @returns {boolean} API is ok?
 */
async function verifyAPIKey(key) {
    if (typeof key !== "string") {
        return false;
    }

    const separatorIndex = key.indexOf("_");
    if (!key.startsWith("uk") || separatorIndex <= 2 || separatorIndex >= key.length - 1) {
        return false;
    }

    // uk prefix + key ID is before _
    let index = key.substring(2, separatorIndex);
    let clear = key.substring(separatorIndex + 1, key.length);

    if (!/^\d+$/.test(index)) {
        return false;
    }

    let hash = await R.findOne("api_key", " id=? ", [index]);

    if (hash === null) {
        return false;
    }

    let current = dayjs();
    let expiry = dayjs(hash.expires);
    if (expiry.diff(current) < 0 || !hash.active) {
        return false;
    }

    return hash && passwordHash.verify(clear, hash.key);
}

/**
 * Callback for basic auth authorizers
 * @callback authCallback
 * @param {any} err Any error encountered
 * @param {boolean} authorized Is the client authorized?
 */

/**
 * Custom authorizer for express-basic-auth
 * @param {string} username Username to login with
 * @param {string} password Password to login with
 * @param {authCallback} callback Callback to handle login result
 * @param {string} rateLimitKey Per-client rate limit key
 * @returns {void}
 */
function apiAuthorizer(username, password, callback, rateLimitKey) {
    // API Rate Limit
    apiAttemptRateLimiter.pass(rateLimitKey, null, 0).then((pass) => {
        if (pass) {
            verifyAPIKey(password).then((valid) => {
                if (!valid) {
                    log.warn("api-auth", "Failed API auth attempt: invalid API Key");
                }
                callback(null, valid);
                // Only allow a set number of api requests per minute
                // (currently set to 60)
                apiAttemptRateLimiter.removeTokens(rateLimitKey, 1);
            });
        } else {
            log.warn("api-auth", "Failed API auth attempt: rate limit exceeded");
            callback(null, false);
        }
    });
}

/**
 * Custom authorizer for express-basic-auth
 * @param {string} username Username to login with
 * @param {string} password Password to login with
 * @param {authCallback} callback Callback to handle login result
 * @param {string} rateLimitKey Per-client rate limit key
 * @returns {void}
 */
function userAuthorizer(username, password, callback, rateLimitKey) {
    // Login Rate Limit
    loginAttemptRateLimiter.pass(rateLimitKey, null, 0).then((pass) => {
        if (pass) {
            exports.login(username, password).then((user) => {
                callback(null, user != null);

                if (user == null) {
                    log.warn("basic-auth", "Failed basic auth attempt: invalid username/password");
                    loginAttemptRateLimiter.removeTokens(rateLimitKey, 1);
                }
            });
        } else {
            log.warn("basic-auth", "Failed basic auth attempt: rate limit exceeded");
            callback(null, false);
        }
    });
}

/**
 * Use basic auth if auth is not disabled
 * @param {express.Request} req Express request object
 * @param {express.Response} res Express response object
 * @param {express.NextFunction} next Next handler in chain
 * @returns {Promise<void>}
 */
exports.basicAuth = async function (req, res, next) {
    const rateLimitKey = getClientRateLimitKey(req);
    const middleware = basicAuth({
        authorizer: (username, password, callback) => userAuthorizer(username, password, callback, rateLimitKey),
        authorizeAsync: true,
        challenge: true,
    });

    const disabledAuth = await Settings.get("disableAuth");

    if (!disabledAuth) {
        middleware(req, res, next);
    } else {
        next();
    }
};

/**
 * Use use API Key if API keys enabled, else use basic auth
 * @param {express.Request} req Express request object
 * @param {express.Response} res Express response object
 * @param {express.NextFunction} next Next handler in chain
 * @returns {Promise<void>}
 */
exports.apiAuth = async function (req, res, next) {
    if (!(await Settings.get("disableAuth"))) {
        const rateLimitKey = getClientRateLimitKey(req);
        let usingAPIKeys = await Settings.get("apiKeysEnabled");
        let middleware;
        if (usingAPIKeys) {
            middleware = basicAuth({
                authorizer: (username, password, callback) => apiAuthorizer(username, password, callback, rateLimitKey),
                authorizeAsync: true,
                challenge: true,
            });
        } else {
            middleware = basicAuth({
                authorizer: (username, password, callback) => userAuthorizer(username, password, callback, rateLimitKey),
                authorizeAsync: true,
                challenge: true,
            });
        }
        middleware(req, res, next);
    } else {
        next();
    }
};
