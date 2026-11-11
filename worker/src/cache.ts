// Tiny wrapper over the Workers Cache API. Workers isolates are ephemeral, so the
// in-process dicts used by the Python app are replaced by caches.default.
// Cache problems (quota, unsupported on *.workers.dev) must never fail a request, so
// every operation swallows and logs its error: a miss is always an acceptable result.
const ORIGIN = "https://cache.hebrew-clock.invalid";

export interface CacheLike {
  match(url: string): Promise<Response | undefined>;
  put(url: string, res: Response): Promise<void>;
}

export function defaultCache(): CacheLike {
  return caches.default as unknown as CacheLike;
}

export async function cacheGet<T>(cache: CacheLike, key: string): Promise<T | undefined> {
  try {
    const res = await cache.match(`${ORIGIN}/${key}`);
    return res ? ((await res.json()) as T) : undefined;
  } catch (err) {
    console.warn(`cache get failed [${key}]: ${err}`);
    return undefined;
  }
}

export async function cachePut(cache: CacheLike, key: string, value: unknown, ttlSeconds: number): Promise<void> {
  try {
    await cache.put(
      `${ORIGIN}/${key}`,
      new Response(JSON.stringify(value), {
        headers: { "content-type": "application/json", "cache-control": `max-age=${ttlSeconds}` },
      }),
    );
  } catch (err) {
    console.warn(`cache put failed [${key}]: ${err}`);
  }
}
