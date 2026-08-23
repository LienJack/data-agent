import { Redis } from "@upstash/redis";
import type { RedisRestClient } from "./namespace.js";

const maximumScanPages = 100;

export function createUpstashRedisRestClient(redis: Redis): RedisRestClient {
  return {
    async get(key) {
      return redis.get<string>(key);
    },
    async setex(key, ttlSeconds, value) {
      const result = await redis.set(key, value, { ex: ttlSeconds });
      if (result !== "OK") throw new Error("UPSTASH_SET_REJECTED");
      return result;
    },
    async del(key) {
      return redis.del(key);
    },
    async scan(match) {
      let cursor = "0";
      let pages = 0;
      const keys = new Set<string>();
      do {
        const [nextCursor, page] = await redis.scan(cursor, {
          match,
          count: 1_000,
        });
        for (const key of page) keys.add(key);
        cursor = nextCursor;
        pages += 1;
        if (pages >= maximumScanPages && cursor !== "0") {
          throw new Error("UPSTASH_SCAN_PAGE_LIMIT");
        }
      } while (cursor !== "0");
      return [...keys].sort();
    },
  };
}

export function createUpstashRedisRestClientFromEnv(): RedisRestClient {
  return createUpstashRedisRestClient(Redis.fromEnv());
}
