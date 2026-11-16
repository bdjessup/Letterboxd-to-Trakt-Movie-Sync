/// <reference path="../../worker-configuration.d.ts" />

/** Merge Cloudflare's default cache into the browser DOM interface. */
interface CacheStorage {
  readonly default: Cache;
}
