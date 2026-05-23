type Level = "info" | "warn" | "error";

export function log(level: Level, msg: string, meta?: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify({ ...meta, level, msg, time: new Date().toISOString() })}\n`);
}
