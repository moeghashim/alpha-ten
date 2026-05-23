import { createHash } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import { pool } from "./db.js";

type Variables = {
  appId: string;
};

type AppKeyRow = {
  app_id: string;
};

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const authCache = new Map<string, number>();
const negativeAuthCache = new Map<string, number>();

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

function cacheKey(appId: string, keyHash: string): string {
  return `${appId}:${keyHash}`;
}

function parseBearer(header: string | undefined): string | null {
  if (!header?.startsWith("Bearer ")) {
    return null;
  }

  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

export const auth: MiddlewareHandler<{ Variables: Variables }> = async (c, next) => {
  const key = parseBearer(c.req.header("Authorization"));
  const appId = c.req.header("X-App-Id");

  if (!key || !appId || !uuidRegex.test(appId)) {
    return c.json({ error: "unauthorized" }, 401);
  }

  const keyHash = hashKey(key);
  const negativeCachedUntil = negativeAuthCache.get(keyHash);

  if (negativeCachedUntil && negativeCachedUntil > Date.now()) {
    return c.json({ error: "unauthorized" }, 401);
  }

  const cachedUntil = authCache.get(cacheKey(appId, keyHash));

  if (cachedUntil && cachedUntil > Date.now()) {
    c.set("appId", appId);
    await next();
    return;
  }

  const result = await pool.query<AppKeyRow>("select app_id from app_keys where key_hash = $1", [keyHash]);

  if (result.rows.length === 0) {
    negativeAuthCache.set(keyHash, Date.now() + 10_000);
    return c.json({ error: "unauthorized" }, 401);
  }

  if (!result.rows.some((row) => row.app_id === appId)) {
    return c.json({ error: "forbidden" }, 403);
  }

  authCache.set(cacheKey(appId, keyHash), Date.now() + 60_000);
  c.set("appId", appId);
  await next();
};
