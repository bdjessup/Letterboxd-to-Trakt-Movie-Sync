import {
  getCookie,
  getRequestUrl,
  getResponseHeaders,
  useSession as openSession,
} from "@tanstack/react-start/server";
import { isValidTimeZone } from "@/lib/dates";
import type { Viewer } from "@/lib/types";
import type { AppEnv } from "./env";
import {
  type OAuthClient,
  refreshAccessToken,
  type TokenResponse,
  type TraktApp,
  TraktError,
} from "./trakt";

export const SESSION_COOKIE = "lbt_session";
export const OAUTH_STATE_COOKIE = "lbt_oauth_state";
const SESSION_MAX_AGE_S = 60 * 60 * 24 * 90;
/** Refresh access tokens this long before they expire. */
const REFRESH_MARGIN_MS = 10 * 60 * 1000;

export interface SessionData {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms. */
  expiresAt: number;
  viewer: Viewer;
}

export function isSecureRequest(): boolean {
  return getRequestUrl().protocol === "https:";
}

function sessionConfig(env: AppEnv) {
  return {
    name: SESSION_COOKIE,
    password: env.SESSION_SECRET,
    maxAge: SESSION_MAX_AGE_S,
    // Only accept the session from its HttpOnly cookie, never from a request header.
    sessionHeader: false as const,
    cookie: {
      httpOnly: true,
      secure: isSecureRequest(),
      sameSite: "lax" as const,
      path: "/",
    },
  };
}

export function redirectUri(env: AppEnv): string {
  return env.TRAKT_REDIRECT_URI ?? new URL("/api/auth/callback", getRequestUrl().origin).toString();
}

export function traktApp(env: AppEnv): TraktApp {
  return { clientId: env.TRAKT_CLIENT_ID, apiUrl: env.TRAKT_API_URL };
}

export function oauthClient(env: AppEnv): OAuthClient {
  return {
    app: traktApp(env),
    clientSecret: env.TRAKT_CLIENT_SECRET,
    redirectUri: redirectUri(env),
  };
}

function isSessionData(data: Partial<SessionData>): data is SessionData {
  return (
    typeof data.accessToken === "string" &&
    typeof data.refreshToken === "string" &&
    typeof data.expiresAt === "number" &&
    typeof data.viewer?.username === "string"
  );
}

export async function readSession(env: AppEnv): Promise<SessionData | null> {
  // Don't mint a session cookie for visitors who haven't connected Trakt.
  if (!getCookie(SESSION_COOKIE)) return null;
  const session = await openSession<Partial<SessionData>>(sessionConfig(env));
  return isSessionData(session.data) ? session.data : null;
}

export async function writeSession(env: AppEnv, data: SessionData): Promise<void> {
  const session = await openSession<Partial<SessionData>>(sessionConfig(env));
  await session.update(data);
}

export async function clearSession(env: AppEnv): Promise<void> {
  if (!getCookie(SESSION_COOKIE)) return;
  const session = await openSession<Partial<SessionData>>(sessionConfig(env));
  await session.clear();
}

export function tokensToSession(tokens: TokenResponse, viewer: Viewer): SessionData {
  const issuedAt = tokens.created_at ? tokens.created_at * 1000 : Date.now();
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: issuedAt + tokens.expires_in * 1000,
    viewer: {
      ...viewer,
      timeZone: viewer.timeZone && isValidTimeZone(viewer.timeZone) ? viewer.timeZone : null,
    },
  };
}

const signedOut = () =>
  new TraktError(401, "unauthorized", "Connect your Trakt account to continue.");

async function refresh(env: AppEnv, data: SessionData): Promise<string> {
  try {
    const tokens = await refreshAccessToken(oauthClient(env), data.refreshToken);
    await writeSession(env, tokensToSession(tokens, data.viewer));
    return tokens.access_token;
  } catch (err) {
    if (err instanceof TraktError && (err.status === 400 || err.status === 401)) {
      await clearSession(env);
      throw signedOut();
    }
    // Trakt is unreachable: keep using the current token while it's still valid.
    if (data.expiresAt > Date.now()) return data.accessToken;
    throw err;
  }
}

/**
 * Run `fn` with the signed-in user's access token, refreshing it when it's about to
 * expire, and once more if Trakt rejects it. A 401 means Trakt didn't apply the request,
 * so retrying is safe even for writes.
 */
export async function withAccessToken<T>(
  env: AppEnv,
  fn: (token: string) => Promise<T>,
): Promise<T> {
  const data = await readSession(env);
  if (!data) throw signedOut();

  const token =
    data.expiresAt - Date.now() < REFRESH_MARGIN_MS ? await refresh(env, data) : data.accessToken;
  try {
    return await fn(token);
  } catch (err) {
    if (!(err instanceof TraktError) || err.status !== 401) throw err;
    const current = await readSession(env);
    if (!current) throw signedOut();
    return fn(await refresh(env, current));
  }
}

/**
 * Redirect while keeping any cookies set during this request. (Start only merges
 * prepared headers into 2xx responses, so redirects need them copied over.)
 */
export function redirectWithCookies(location: string, status = 302): Response {
  const headers = new Headers({ Location: location, "Cache-Control": "no-store" });
  for (const cookie of getResponseHeaders().getSetCookie?.() ?? []) {
    headers.append("Set-Cookie", cookie);
  }
  return new Response(null, { status, headers });
}
