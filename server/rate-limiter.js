const { RateLimiter } = require("limiter");
const { log } = require("../src/util");

class KumaRateLimiter {
    /**
     * @param {object} config Rate limiter configuration object
     */
    constructor(config) {
        this.errorMessage = config.errorMessage;
        this.rateLimiter = new RateLimiter(config);
    }

    /**
     * Callback for pass
     * @callback passCB
     * @param {object} err Too many requests
     */

    /**
     * Should the request be passed through
     * @param {passCB} callback Callback function to call with decision
     * @param {number} num Number of tokens to remove
     * @returns {Promise<boolean>} Should the request be allowed?
     */
    async pass(callback, num = 1) {
        const remainingRequests = await this.removeTokens(num);
        log.info("rate-limit", "remaining requests: " + remainingRequests);
        if (remainingRequests < 0) {
            if (callback) {
                callback({
                    ok: false,
                    msg: this.errorMessage,
                });
            }
            return false;
        }
        return true;
    }

    /**
     * Remove a given number of tokens
     * @param {number} num Number of tokens to remove
     * @returns {Promise<number>} Number of remaining tokens
     */
    async removeTokens(num = 1) {
        return await this.rateLimiter.removeTokens(num);
    }
}

class ScopedKumaRateLimiter {
    /**
     * @param {object} config Rate limiter configuration object
     */
    constructor(config) {
        this.errorMessage = config.errorMessage;
        this.tokensPerInterval = config.tokensPerInterval;
        this.interval = config.interval;
        this.fireImmediately = config.fireImmediately;
        this.maxEntries = config.maxEntries || 5000;
        this.limiters = new Map();
    }

    /**
     * @param {string} key Limiter key
     * @returns {RateLimiter} Rate limiter instance
     */
    getLimiter(key) {
        const normalizedKey = typeof key === "string" && key !== "" ? key : "global";
        let limiter = this.limiters.get(normalizedKey);

        if (!limiter) {
            limiter = new RateLimiter({
                tokensPerInterval: this.tokensPerInterval,
                interval: this.interval,
                fireImmediately: this.fireImmediately,
            });
            this.limiters.set(normalizedKey, limiter);
            this.prune();
        } else {
            this.limiters.delete(normalizedKey);
            this.limiters.set(normalizedKey, limiter);
        }

        return limiter;
    }

    /**
     * Keep limiter registry bounded.
     * @returns {void}
     */
    prune() {
        while (this.limiters.size > this.maxEntries) {
            const oldestKey = this.limiters.keys().next().value;
            if (!oldestKey) {
                break;
            }
            this.limiters.delete(oldestKey);
        }
    }

    /**
     * Should the request be passed through for the given key
     * @param {string} key Limiter key
     * @param {passCB} callback Callback function to call with decision
     * @param {number} num Number of tokens to remove
     * @returns {Promise<boolean>} Should the request be allowed?
     */
    async pass(key, callback, num = 1) {
        const remainingRequests = await this.removeTokens(key, num);
        log.info("rate-limit", `remaining requests for ${key}: ${remainingRequests}`);
        if (remainingRequests < 0) {
            if (callback) {
                callback({
                    ok: false,
                    msg: this.errorMessage,
                });
            }
            return false;
        }
        return true;
    }

    /**
     * Remove a given number of tokens for a specific key
     * @param {string} key Limiter key
     * @param {number} num Number of tokens to remove
     * @returns {Promise<number>} Number of remaining tokens
     */
    async removeTokens(key, num = 1) {
        return await this.getLimiter(key).removeTokens(num);
    }
}

const loginRateLimiter = new KumaRateLimiter({
    tokensPerInterval: 20,
    interval: "minute",
    fireImmediately: true,
    errorMessage: "Too frequently, try again later.",
});

const apiRateLimiter = new KumaRateLimiter({
    tokensPerInterval: 60,
    interval: "minute",
    fireImmediately: true,
    errorMessage: "Too frequently, try again later.",
});

const loginAttemptRateLimiter = new ScopedKumaRateLimiter({
    tokensPerInterval: 20,
    interval: "minute",
    fireImmediately: true,
    maxEntries: 5000,
    errorMessage: "Too frequently, try again later.",
});

const apiAttemptRateLimiter = new ScopedKumaRateLimiter({
    tokensPerInterval: 60,
    interval: "minute",
    fireImmediately: true,
    maxEntries: 5000,
    errorMessage: "Too frequently, try again later.",
});

const twoFaRateLimiter = new KumaRateLimiter({
    tokensPerInterval: 30,
    interval: "minute",
    fireImmediately: true,
    errorMessage: "Too frequently, try again later.",
});

module.exports = {
    loginRateLimiter,
    apiRateLimiter,
    loginAttemptRateLimiter,
    apiAttemptRateLimiter,
    twoFaRateLimiter,
};
