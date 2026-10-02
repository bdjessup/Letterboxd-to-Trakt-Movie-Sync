import { env as workerEnv } from "cloudflare:workers";

export interface AppEnv {
  TRAKT_CLIENT_ID: string;
  TRAKT_CLIENT_SECRET: string;
  SESSION_SECRET: string;
  TRAKT_REDIRECT_URI?: string;
  /** Trakt API origin. Only overridden to test against a mock server. */
  TRAKT_API_URL: string;
  /** Trakt website origin (for the OAuth consent page). Only overridden for testing. */
  TRAKT_WEB_URL: string;
}

const DEFAULT_API_URL = "https://api.trakt.tv";
const DEFAULT_WEB_URL = "https://trakt.tv";

const REQUIRED = ["TRAKT_CLIENT_ID", "TRAKT_CLIENT_SECRET", "SESSION_SECRET"] as const;

export class ConfigError extends Error {
  override name = "ConfigError";
}

function originOption(source: Record<string, unknown>, key: string, fallback: string): string {
  const value = source[key];
  if (typeof value !== "string" || !value) return fallback;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigError(`${key} must be a URL.`);
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new ConfigError(`${key} must use https.`);
  }
  return url.origin;
}

/** Read and validate configuration. Call per request, not at module load. */
export function getEnv(): AppEnv {
  const source = workerEnv as Record<string, unknown>;
  const missing = REQUIRED.filter((key) => typeof source[key] !== "string" || !source[key]);
  if (missing.length > 0) {
    throw new ConfigError(
      `Missing configuration: ${missing.join(", ")}. Set them in .dev.vars locally or with \`wrangler secret put\`.`,
    );
  }
  const secret = source.SESSION_SECRET as string;
  if (secret.length < 32) {
    throw new ConfigError("SESSION_SECRET must be at least 32 characters.");
  }
  const redirect = source.TRAKT_REDIRECT_URI;
  return {
    TRAKT_CLIENT_ID: source.TRAKT_CLIENT_ID as string,
    TRAKT_CLIENT_SECRET: source.TRAKT_CLIENT_SECRET as string,
    SESSION_SECRET: secret,
    TRAKT_REDIRECT_URI: typeof redirect === "string" && redirect ? redirect : undefined,
    TRAKT_API_URL: originOption(source, "TRAKT_API_URL", DEFAULT_API_URL),
    TRAKT_WEB_URL: originOption(source, "TRAKT_WEB_URL", DEFAULT_WEB_URL),
  };
}
