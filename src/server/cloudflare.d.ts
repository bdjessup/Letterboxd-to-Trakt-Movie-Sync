declare module "cloudflare:workers" {
  /** Bindings, vars and secrets for this Worker. */
  export const env: Record<string, unknown>;
}

/** Cloudflare's per-colo HTTP cache (`caches.default`), absent outside Workers. */
interface CacheStorage {
  readonly default?: Cache;
}
