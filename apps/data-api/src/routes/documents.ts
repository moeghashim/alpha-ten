import { Hono } from "hono";
import { z, ZodError } from "zod";
import { withAppContext } from "../db.js";

type Variables = {
  appId: string;
};

type DocumentRow = {
  id: string;
  body: unknown;
  updated_at: string;
};

type CountRow = {
  count: string;
};

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const collectionRegex = /^[a-z0-9][a-z0-9_-]{0,62}$/;
const maxBodyBytes = Number(process.env.MAX_BODY_BYTES ?? 1_048_576);
const maxDocsPerApp = Number(process.env.MAX_DOCS_PER_APP ?? 10_000);

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(100),
  cursor: z.string().datetime({ offset: true }).optional()
});

const putBodySchema = z.object({
  body: z.unknown()
});

export const documentsRoute = new Hono<{ Variables: Variables }>();

async function validateScope(
  appId: string,
  collection: string,
  authedAppId: string | undefined
): Promise<Response | null> {
  if (!uuidRegex.test(appId) || !collectionRegex.test(collection)) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  if (authedAppId !== appId) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  return null;
}

documentsRoute.use("/:appId/:col", async (c, next) => {
  const appId = c.req.param("appId");
  const collection = c.req.param("col");
  const failure = await validateScope(appId, collection, c.get("appId"));

  if (failure) {
    return failure;
  }

  await next();
});

documentsRoute.use("/:appId/:col/*", async (c, next) => {
  const appId = c.req.param("appId");
  const collection = c.req.param("col");
  const failure = await validateScope(appId, collection, c.get("appId"));

  if (failure) {
    return failure;
  }

  await next();
});

documentsRoute.get("/:appId/:col", async (c) => {
  const appId = c.req.param("appId");
  const collection = c.req.param("col");
  const parsedQuery = listQuerySchema.safeParse(c.req.query());

  if (!parsedQuery.success) {
    return c.json({ error: "bad_request" }, 400);
  }

  const query = parsedQuery.data;
  const values: Array<string | number> = [appId, collection, query.limit + 1];
  const cursorClause = query.cursor ? "and updated_at < $4::timestamptz" : "";

  if (query.cursor) {
    values.push(query.cursor);
  }

  const rows = await withAppContext(appId, async (client) => {
    const result = await client.query<DocumentRow>(
      `select doc_id as id, body, updated_at
       from documents
       where app_id = $1 and collection = $2 and deleted_at is null
       ${cursorClause}
       order by updated_at desc
       limit $3`,
      values
    );

    return result.rows;
  });

  const docs = rows.slice(0, query.limit);
  const next = rows.length > query.limit ? docs.at(-1)?.updated_at : undefined;

  return c.json(next ? { docs, next } : { docs });
});

documentsRoute.get("/:appId/:col/:id", async (c) => {
  const appId = c.req.param("appId");
  const collection = c.req.param("col");
  const docId = c.req.param("id");

  const row = await withAppContext(appId, async (client) => {
    const result = await client.query<DocumentRow>(
      `select doc_id as id, body, updated_at
       from documents
       where app_id = $1
         and collection = $2
         and doc_id = $3
         and deleted_at is null`,
      [appId, collection, docId]
    );

    return result.rows[0] ?? null;
  });

  if (!row) {
    return c.json({ error: "not_found" }, 404);
  }

  return c.json(row);
});

documentsRoute.put("/:appId/:col/:id", async (c) => {
  const appId = c.req.param("appId");
  const collection = c.req.param("col");
  const docId = c.req.param("id");
  const raw = await c.req.text();

  if (Buffer.byteLength(raw, "utf8") > maxBodyBytes) {
    return c.json({ error: "payload_too_large" }, 413);
  }

  let payload: z.infer<typeof putBodySchema>;

  try {
    payload = putBodySchema.parse(JSON.parse(raw));
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof ZodError) {
      return c.json({ error: "bad_request" }, 400);
    }

    throw error;
  }

  const row = await withAppContext(appId, async (client) => {
    const existing = await client.query<{ exists: boolean }>(
      `select exists (
         select 1 from documents
         where app_id = $1 and collection = $2 and doc_id = $3 and deleted_at is null
       )`,
      [appId, collection, docId]
    );

    if (!existing.rows[0]?.exists) {
      const count = await client.query<CountRow>(
        "select count(*) from documents where app_id = $1 and deleted_at is null",
        [appId]
      );

      if (Number(count.rows[0]?.count ?? 0) >= maxDocsPerApp) {
        return null;
      }
    }

    const upsert = await client.query<DocumentRow>(
      `insert into documents (app_id, collection, doc_id, body, deleted_at)
       values ($1, $2, $3, $4::jsonb, null)
       on conflict (app_id, collection, doc_id)
       do update set body = excluded.body, deleted_at = null
       returning doc_id as id, body, updated_at`,
      [appId, collection, docId, JSON.stringify(payload.body)]
    );

    return upsert.rows[0];
  });

  if (!row) {
    return c.json({ error: "doc_limit_exceeded" }, 413);
  }

  return c.json(row);
});

documentsRoute.delete("/:appId/:col/:id", async (c) => {
  const appId = c.req.param("appId");
  const collection = c.req.param("col");
  const docId = c.req.param("id");

  await withAppContext(appId, async (client) => {
    await client.query(
      `update documents
       set deleted_at = now()
       where app_id = $1 and collection = $2 and doc_id = $3`,
      [appId, collection, docId]
    );
  });

  return c.body(null, 204);
});
