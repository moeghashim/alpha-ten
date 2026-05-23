import type { MiddlewareHandler } from "hono";

type Variables = {
  appId: string;
};

type Bucket = {
  tokens: number;
  updatedAt: number;
};

const rate = Math.max(1, Number(process.env.RATE_LIMIT_PER_SEC ?? 50));
const capacity = rate * 2;
const buckets = new Map<string, Bucket>();

export const rateLimit: MiddlewareHandler<{ Variables: Variables }> = async (c, next) => {
  const appId = c.get("appId");
  const now = Date.now();
  const bucket = buckets.get(appId) ?? { tokens: capacity, updatedAt: now };
  const elapsedSeconds = (now - bucket.updatedAt) / 1000;

  bucket.tokens = Math.min(capacity, bucket.tokens + elapsedSeconds * rate);
  bucket.updatedAt = now;

  if (bucket.tokens < 1) {
    buckets.set(appId, bucket);
    c.header("Retry-After", "1");
    return c.json({ error: "rate_limited" }, 429);
  }

  bucket.tokens -= 1;
  buckets.set(appId, bucket);
  await next();
};
