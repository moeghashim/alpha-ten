import { z } from "zod";

const slugRegex = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const reservedSlugs = new Set(["api", "data", "admin", "www", "app", "apps", "alpha", "health"]);
const denylist = ["porn", "casino", "weapon", "malware", "phishing", "keylogger", "creditcard"];

const createAppSchema = z.object({
  slug: z.string().trim().regex(slugRegex, "slug must match ^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$"),
  description: z.string().trim().min(1, "description is required").max(300, "description must be 300 chars or less")
});

export function validateCreateApp(input: unknown): { slug: string; description: string } {
  const parsed = createAppSchema.parse(input);

  if (reservedSlugs.has(parsed.slug)) {
    throw new Error("slug is reserved");
  }

  if (/\bhttps?:\/\//i.test(parsed.description)) {
    throw new Error("description must not contain URLs");
  }

  const lower = parsed.description.toLowerCase();
  const blocked = denylist.find((word) => lower.includes(word));
  if (blocked) {
    throw new Error(`description contains a blocked term: ${blocked}`);
  }

  return parsed;
}
