import { redisClient } from '../sessions/redis-keys.js';
import { OperationalError } from '@workspace/errors';
import { logger } from '@workspace/logger';

/**
 * Creates a Redis-backed sliding-window rate limit middleware.
 * 
 * @param {object} options
 * @param {number} options.windowMs - Window size in milliseconds
 * @param {number} options.max - Max hits per window
 * @param {string} options.keyPrefix - Prefix for the Redis key (e.g., 'rl:oauth')
 */
export function createRateLimiter({ windowMs, max, keyPrefix }) {
  return async (req, res, next) => {
    try {
      // In a real production setup behind a proxy, use req.headers['x-forwarded-for'] or req.ip
      const ip = req.ip || req.connection?.remoteAddress || 'unknown-ip';
      const key = `${keyPrefix}:${ip}`;
      const now = Date.now();
      const windowStart = now - windowMs;

      // Sliding window using a Redis Sorted Set
      const multi = redisClient.multi();
      
      // 1. Remove timestamps older than the sliding window
      multi.zremrangebyscore(key, 0, windowStart);
      
      // 2. Add current timestamp
      // Score and member are both the timestamp. To handle duplicate timestamps in the same ms,
      // we append a random string or just let them overwrite (which slightly undercounts extreme bursts,
      // but is fine for this use case). We'll append a random suffix to ensure uniqueness.
      const member = `${now}-${Math.random().toString(36).slice(2, 8)}`;
      multi.zadd(key, now, member);
      
      // 3. Count remaining timestamps in the window
      multi.zcard(key);
      
      // 4. Update the TTL of the key so it cleans up when idle
      multi.pexpire(key, windowMs);
      
      const results = await multi.exec();
      
      if (!results) {
        throw new Error('Redis transaction failed');
      }

      // results[2] corresponds to the zcard command
      const hitCount = results[2][1];

      if (hitCount > max) {
        logger.warn({ ip, keyPrefix, hitCount }, 'Rate limit exceeded');
        // Spec §11.7 dictates using 429 status code
        throw new OperationalError('Too many requests, please try again later.', 429, 'RATE_LIMIT_EXCEEDED');
      }

      next();
    } catch (err) {
      if (err instanceof OperationalError) {
        next(err);
      } else {
        // Log infrastructure failure but fail OPEN for rate-limiting.
        // (Session validation is responsible for failing CLOSED if auth is strictly required).
        logger.error({ err }, 'Rate limiter failed due to infrastructure error');
        next();
      }
    }
  };
}

// Pre-configured rate limiter for OAuth endpoints
// E.g., 20 requests per 15 minutes is a generous allowance for a single IP's login flow
export const oauthRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  keyPrefix: 'rl:oauth'
});
