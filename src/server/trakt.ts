import type {
  ErrorCode,
  LibraryKind,
  PushRequest,
  PushResult,
  TraktMovieRef,
  Viewer,
} from "@/lib/types";
import type { ReadPacing } from "./read-pacing";

export const DEFAULT_TRAKT_API = "https://api.trakt.tv";
export const DEFAULT_TRAKT_WEB = "https://auth.trakt.tv";
const USER_AGENT =
  "letterboxd-to-trakt/2.0 (+https://github.com/bdjessup/letterboxd-to-trakt-movie-sync)";

/** Default time to spend waiting for rate limits before handing control back. */
const MAX_INLINE_WAIT_S = 5;
const MAX_RETRIES = 2;

export class TraktError extends Error {
  override name = "TraktError";
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly retryAfter?: number,
  ) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, Math.ceil(seconds));
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

function errorFor(status: number, retryAfter: number | undefined, headers: Headers): TraktError {
  switch (status) {
    case 401:
      return new TraktError(
        status,
        "unauthorized",
        "Your Trakt session has expired. Please reconnect.",
      );
    case 403:
      return new TraktError(status, "bad_request", "Trakt rejected this app's API key.");
    case 420: {
      const limit = headers.get("X-Account-Limit");
      return new TraktError(
        status,
        "account_limit",
        `Your Trakt account hit its limit${limit ? ` of ${limit} items` : ""}. Trakt VIP raises it.`,
      );
    }
    case 423:
      return new TraktError(
        status,
        "unauthorized",
        "Your Trakt account is locked. Check trakt.tv.",
      );
    case 429:
      return new TraktError(
        status,
        "rate_limited",
        "Trakt asked us to slow down.",
        retryAfter ?? 10,
      );
    default:
      if (status >= 500) {
        return new TraktError(
          status,
          "unavailable",
          "Trakt is having trouble right now. Try again shortly.",
        );
      }
      return new TraktError(status, "bad_request", `Trakt rejected the request (HTTP ${status}).`);
  }
}

/** Which Trakt app (and API origin) requests are made as. */
export interface TraktApp {
  clientId: string;
  apiUrl: string;
  readPacing?: ReadPacing;
  readMetrics?: {
    upstreamReads: number;
    retries: number;
    pacingWaitMs: number;
    rateLimits: number;
  };
}

export interface TraktRequestOptions {
  token?: string;
  method?: "GET" | "POST";
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  rateLimitBudgetS?: number;
}

/**
 * Call the Trakt API. Paths are always constants from this module; the URL is checked so
 * nothing can redirect a request to another host.
 *
 * GETs are retried on network errors and 5xx. Writes are only retried on 429, which means
 * Trakt didn't process them; anything else could double-apply, so it's reported instead.
 */
export async function traktRequest<T>(
  app: TraktApp,
  path: string,
  {
    token,
    method = "GET",
    query,
    body,
    rateLimitBudgetS = MAX_INLINE_WAIT_S,
  }: TraktRequestOptions = {},
): Promise<{ data: T; headers: Headers }> {
  const origin = new URL(app.apiUrl).origin;
  const url = new URL(path, origin);
  if (url.origin !== origin || !path.startsWith("/") || path.startsWith("//")) {
    throw new Error(`Refusing to call non-Trakt URL: ${path}`);
  }
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  const headers = new Headers({
    "Content-Type": "application/json",
    "trakt-api-version": "2",
    "trakt-api-key": app.clientId,
    "User-Agent": USER_AGENT,
  });
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let rateLimitWaitedS = 0;
  for (let attempt = 0; ; attempt++) {
    if (method === "GET") {
      const waited = (await app.readPacing?.before()) ?? 0;
      if (app.readMetrics) {
        app.readMetrics.pacingWaitMs += waited;
        app.readMetrics.upstreamReads++;
        if (attempt > 0) app.readMetrics.retries++;
      }
    }
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      if (method === "GET" && attempt < MAX_RETRIES) {
        await sleep(500 * (attempt + 1));
        continue;
      }
      throw new TraktError(
        0,
        "network",
        "Couldn't reach Trakt. Check your connection and try again.",
      );
    }

    if (res.ok) {
      const text = await res.text();
      return { data: (text ? JSON.parse(text) : null) as T, headers: res.headers };
    }

    await res.body?.cancel();
    const retryAfter = parseRetryAfter(res.headers.get("Retry-After"));
    if (res.status === 429) {
      if (method === "GET") {
        if (app.readMetrics) app.readMetrics.rateLimits++;
        await app.readPacing?.pause(retryAfter ?? 10);
      }
      console.warn({
        event: "trakt_rate_limited",
        endpoint: path,
        retryAfter,
        rateLimit: res.headers.get("X-Ratelimit"),
        contentType: res.headers.get("Content-Type"),
      });
    }
    const canRetry = attempt < MAX_RETRIES;
    // Batched readers need partial results immediately; the browser owns the countdown.
    if (res.status === 429 && method === "GET" && app.readPacing) {
      throw errorFor(res.status, retryAfter, res.headers);
    }
    const waitS = retryAfter ?? 1;
    if (res.status === 429 && canRetry && rateLimitWaitedS + waitS <= rateLimitBudgetS) {
      rateLimitWaitedS += waitS;
      await sleep(waitS * 1000 + 250);
      continue;
    }
    if (res.status >= 500 && method === "GET" && canRetry) {
      await sleep(750 * (attempt + 1));
      continue;
    }
    throw errorFor(res.status, retryAfter, res.headers);
  }
}

// ---------------------------------------------------------------------------------------
// Response shapes (only the fields we read)

interface RawIds {
  trakt?: number;
  slug?: string;
  imdb?: string | null;
  tmdb?: number | null;
}

interface RawMovie {
  title?: string;
  year?: number | null;
  ids?: RawIds;
}

export function toMovieRef(raw: RawMovie | undefined): TraktMovieRef | null {
  const trakt = raw?.ids?.trakt;
  if (!raw || typeof trakt !== "number" || !Number.isInteger(trakt) || trakt <= 0) return null;
  return {
    trakt,
    slug: raw.ids?.slug ?? String(trakt),
    title: raw.title ?? "Untitled",
    year: typeof raw.year === "number" ? raw.year : null,
    imdb: raw.ids?.imdb ?? null,
    tmdb: raw.ids?.tmdb ?? null,
  };
}

// ---------------------------------------------------------------------------------------
// Endpoints

export async function searchMovies(
  app: TraktApp,
  token: string,
  query: string,
  year: number | null,
): Promise<TraktMovieRef[]> {
  const { data } = await traktRequest<{ movie?: RawMovie }[]>(app, "/search/movie", {
    token,
    query: { query, years: year ?? undefined, limit: 10 },
  });
  return (Array.isArray(data) ? data : []).flatMap((r) => toMovieRef(r.movie) ?? []);
}

export const LIBRARY_PAGE_SIZE = 250;

export type LibraryPage = { movies: TraktMovieRef[] } & (
  | { kind: "history"; page: number; pageCount: number; items: [number, string][] }
  | { kind: "ratings"; page: number; pageCount: number; items: [number, number][] }
  | { kind: "watchlist"; page: number; pageCount: number; items: number[] }
);

const LIBRARY_PATHS: Record<LibraryKind, string> = {
  history: "/sync/history/movies",
  ratings: "/sync/ratings/movies",
  watchlist: "/sync/watchlist/movies",
};

interface RawLibraryItem {
  movie?: RawMovie;
  watched_at?: string;
  rating?: number;
}

export async function fetchLibraryPage(
  app: TraktApp,
  token: string,
  kind: LibraryKind,
  page: number,
): Promise<LibraryPage> {
  const { data, headers } = await traktRequest<RawLibraryItem[]>(app, LIBRARY_PATHS[kind], {
    token,
    query: { page, limit: LIBRARY_PAGE_SIZE },
  });
  const rows = Array.isArray(data) ? data : [];
  const movies = rows.flatMap((r) => toMovieRef(r.movie) ?? []);
  const pageCount = Number(headers.get("X-Pagination-Page-Count")) || 1;
  const id = (r: RawLibraryItem) => toMovieRef(r.movie)?.trakt;

  switch (kind) {
    case "history":
      return {
        movies,
        kind,
        page,
        pageCount,
        items: rows.flatMap((r): [number, string][] => {
          const trakt = id(r);
          return trakt && r.watched_at ? [[trakt, r.watched_at]] : [];
        }),
      };
    case "ratings":
      return {
        movies,
        kind,
        page,
        pageCount,
        items: rows.flatMap((r): [number, number][] => {
          const trakt = id(r);
          return trakt && typeof r.rating === "number" ? [[trakt, r.rating]] : [];
        }),
      };
    case "watchlist":
      return { movies, kind, page, pageCount, items: rows.flatMap((r) => id(r) ?? []) };
  }
}

interface RawSyncResponse {
  added?: { movies?: number };
  updated?: { movies?: number };
  existing?: { movies?: number };
  not_found?: { movies?: RawMovie[] };
}

export async function pushToTrakt(
  app: TraktApp,
  token: string,
  request: PushRequest,
): Promise<PushResult> {
  let path: string;
  let movies: unknown[];
  switch (request.kind) {
    case "history":
      path = "/sync/history";
      movies = request.items.map((i) => ({ watched_at: i.watchedAt, ids: { trakt: i.trakt } }));
      break;
    case "ratings":
      path = "/sync/ratings";
      movies = request.items.map((i) => ({
        rating: i.rating,
        ...(i.ratedAt ? { rated_at: i.ratedAt } : {}),
        ids: { trakt: i.trakt },
      }));
      break;
    case "watchlist":
      path = "/sync/watchlist";
      movies = request.items.map((i) => ({ ids: { trakt: i.trakt } }));
      break;
  }

  const { data } = await traktRequest<RawSyncResponse>(app, path, {
    token,
    method: "POST",
    body: { movies },
  });
  return {
    added: (data?.added?.movies ?? 0) + (data?.updated?.movies ?? 0),
    existing: data?.existing?.movies ?? 0,
    notFound: (data?.not_found?.movies ?? []).flatMap((m) => m.ids?.trakt ?? []),
  };
}

// ---------------------------------------------------------------------------------------
// OAuth

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  created_at: number;
}

export interface OAuthClient {
  app: TraktApp;
  authUrl: string;
  clientSecret?: string;
  redirectUri: string;
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function createAuthorizationRequest(client: OAuthClient) {
  const state = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const codeVerifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier));
  const url = new URL("/oauth/authorize", client.authUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", client.app.clientId);
  url.searchParams.set("redirect_uri", client.redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("scope", "public offline_access");
  url.searchParams.set("code_challenge", base64url(new Uint8Array(digest)));
  url.searchParams.set("code_challenge_method", "S256");
  return { authorizeUrl: url.toString(), state, codeVerifier };
}

function isTokenResponse(value: unknown): value is TokenResponse {
  const v = value as Partial<TokenResponse> | null;
  return (
    typeof v?.access_token === "string" &&
    typeof v.refresh_token === "string" &&
    typeof v.expires_in === "number"
  );
}

async function requestToken(client: OAuthClient, grant: Record<string, string>) {
  const { data } = await traktRequest<unknown>(
    { ...client.app, apiUrl: client.authUrl },
    "/oauth/token",
    {
      method: "POST",
      body: {
        client_id: client.app.clientId,
        redirect_uri: client.redirectUri,
        ...grant,
      },
    },
  );
  if (!isTokenResponse(data))
    throw new TraktError(502, "unavailable", "Trakt sent an unexpected token response.");
  return data;
}

export function exchangeCode(
  client: OAuthClient,
  code: string,
  codeVerifier: string,
): Promise<TokenResponse> {
  return requestToken(client, {
    code,
    code_verifier: codeVerifier,
    grant_type: "authorization_code",
  });
}

export function refreshAccessToken(
  client: OAuthClient,
  refreshToken: string,
): Promise<TokenResponse> {
  return requestToken(client, {
    refresh_token: refreshToken,
    grant_type: "refresh_token",
    ...(client.clientSecret ? { client_secret: client.clientSecret } : {}),
  });
}

export async function revokeToken(client: OAuthClient, token: string): Promise<void> {
  await traktRequest({ ...client.app, apiUrl: client.authUrl }, "/oauth/revoke", {
    method: "POST",
    body: {
      token,
      client_id: client.app.clientId,
      ...(client.clientSecret ? { client_secret: client.clientSecret } : {}),
    },
  });
}

interface RawSettings {
  user?: {
    username?: string;
    name?: string | null;
    vip?: boolean;
    ids?: { slug?: string };
    images?: { avatar?: { full?: string } };
  };
  account?: { timezone?: string | null };
}

export async function fetchViewer(app: TraktApp, token: string): Promise<Viewer> {
  const { data } = await traktRequest<RawSettings>(app, "/users/settings", {
    token,
    // The callback has already exchanged its one-use code. Wait here so a profile
    // rate limit doesn't force the user through authorization again.
    rateLimitBudgetS: 60,
  });
  const user = data?.user;
  if (!user?.username)
    throw new TraktError(502, "unavailable", "Trakt sent an unexpected profile response.");
  const avatar = user.images?.avatar?.full;
  return {
    username: user.username,
    slug: user.ids?.slug ?? user.username,
    name: user.name || user.username,
    avatarUrl: avatar?.startsWith("https://") ? avatar : null,
    timeZone: data?.account?.timezone ?? null,
    vip: Boolean(user.vip),
  };
}
