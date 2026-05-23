import { createHash } from "node:crypto";
import { nanoid } from "nanoid";
import { pool } from "../db.js";

export function generateAppKey(): string {
  return nanoid(32);
}

export function hashKey(plain: string): string {
  return createHash("sha256").update(plain).digest("hex");
}

export async function insertAppKey(appId: string, plain: string): Promise<void> {
  await pool.query("insert into app_keys (app_id, key_hash) values ($1, $2)", [appId, hashKey(plain)]);
}
