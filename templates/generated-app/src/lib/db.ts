// DO NOT EDIT — provided by the alpha-ten template.
// All generated apps must persist data through this module.

import { nanoid } from "nanoid";

export type Doc<T = unknown> = {
  id: string;
  body: T;
  updated_at: string;
};

export class DbError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "DbError";
  }
}

export type DbCollection<T = unknown> = {
  list(opts?: { limit?: number; cursor?: string }): Promise<{ docs: Doc<T>[]; next?: string }>;
  get(id: string): Promise<Doc<T> | null>;
  put(id: string, body: T): Promise<Doc<T>>;
  delete(id: string): Promise<void>;
};

export type DbClient = {
  collection<T = unknown>(name: string): DbCollection<T>;
  id(): string;
};

export type CreateDbOptions = {
  baseUrl: string;
  appId: string;
  key: string;
};

type ErrorResponse = {
  error?: string;
  message?: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function readError(response: Response): Promise<string> {
  const fallback = `Request failed with status ${response.status}`;

  try {
    const body = (await response.json()) as ErrorResponse;
    return body.message ?? body.error ?? fallback;
  } catch {
    return fallback;
  }
}

export function createDb(opts: CreateDbOptions): DbClient {
  function getBaseUrl(): string {
    if (!opts.baseUrl) {
      throw new DbError(0, "NEXT_PUBLIC_DATA_API_URL is required before using db");
    }

    return opts.baseUrl.replace(/\/$/, "");
  }

  function getHeaders(initHeaders?: HeadersInit): Headers {
    const headers = new Headers(initHeaders);
    headers.set("Authorization", `Bearer ${opts.key}`);
    headers.set("X-App-Id", opts.appId);
    headers.set("Content-Type", "application/json");
    return headers;
  }

  async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
    try {
      const response = await fetch(`${getBaseUrl()}${path}`, {
        ...init,
        headers: getHeaders(init.headers)
      });

      if (!response.ok) {
        throw new DbError(response.status, await readError(response));
      }

      if (response.status === 204) {
        return undefined as T;
      }

      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof DbError) {
        throw error;
      }

      if (retry) {
        await sleep(250);
        return request<T>(path, init, false);
      }

      throw new DbError(0, error instanceof Error ? error.message : "Network error");
    }
  }

  return {
    collection<T = unknown>(name: string): DbCollection<T> {
      const collectionPath = `/v1/d/${encodeURIComponent(opts.appId)}/${encodeURIComponent(name)}`;

      return {
        list(listOpts) {
          const params = new URLSearchParams();
          if (listOpts?.limit !== undefined) {
            params.set("limit", String(listOpts.limit));
          }
          if (listOpts?.cursor !== undefined) {
            params.set("cursor", listOpts.cursor);
          }

          const query = params.size > 0 ? `?${params.toString()}` : "";
          return request<{ docs: Doc<T>[]; next?: string }>(`${collectionPath}${query}`);
        },
        async get(id) {
          try {
            return await request<Doc<T>>(`${collectionPath}/${encodeURIComponent(id)}`);
          } catch (error) {
            if (error instanceof DbError && error.status === 404) {
              return null;
            }
            throw error;
          }
        },
        put(id, body) {
          return request<Doc<T>>(`${collectionPath}/${encodeURIComponent(id)}`, {
            method: "PUT",
            body: JSON.stringify({ body })
          });
        },
        delete(id) {
          return request<void>(`${collectionPath}/${encodeURIComponent(id)}`, {
            method: "DELETE"
          });
        }
      };
    },
    id() {
      return nanoid(12);
    }
  };
}

export const db = createDb({
  baseUrl: process.env.NEXT_PUBLIC_DATA_API_URL!,
  appId: process.env.NEXT_PUBLIC_APP_ID!,
  key: process.env.NEXT_PUBLIC_APP_KEY!
});
