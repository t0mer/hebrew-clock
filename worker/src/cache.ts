// Tiny wrapper over the Workers Cache API. Workers isolates are ephemeral, so the
// in-process dicts used by the Python app are replaced by caches.default.
const ORIGIN = "https://cache.hebrew-clock.invalid";

export interface CacheLike {
  match(url: string): Promise<Response | undefined>;
  put(url: string, res: Response): Promise<void>;
}

export function defaultCache(): CacheLike {
  return caches.default as unknown as CacheLike;
}

export async function cacheGet<T>(cache: CacheLike, key: string): Promise<T | undefined> {
  const res = await cache.match(`${ORIGIN}/${key}`);
  if (!res) return undefined;
  try {
    return (await res.json()) as T;
  } catch {
    return undefined;
  }
}

export async function cachePut(cache: CacheLike, key: string, value: unknown, ttlSeconds: number): Promise<void> {
  await cache.put(
    `${ORIGIN}/${key}`,
    new Response(JSON.stringify(value), {
      headers: { "content-type": "application/json", "cache-control": `max-age=${ttlSeconds}` },
    }),
  );
}
