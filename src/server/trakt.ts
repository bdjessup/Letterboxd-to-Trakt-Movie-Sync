import type {
  ErrorCode,
  LibraryKind,
  PushRequest,
  PushResult,
  TraktMovieRef,
  Viewer,
} from "@/lib/types";

export const DEFAULT_TRAKT_API = "https://api.trakt.tv";
export const DEFAULT_TRAKT_WEB = "https://trakt.tv";
const USER_AGENT =
  "letterboxd-to-trakt/2.0 (+https://github.com/bdjessup/letterboxd-to-trakt-movie-sync)";

/** Longest Retry-After we'll wait out inside one request before handing control back. */
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
}

export interface TraktRequestOptions {
  token?: string;
  method?: "GET" | "POST";
  query?: Record<string, string | number | undefined>;
  body?: unknown;
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
  { token, method = "GET", query, body }: TraktRequestOptions = {},
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

  for (let attempt = 0; ; attempt++) {
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
    const canRetry = attempt < MAX_RETRIES;
    if (res.status === 429 && canRetry && (retryAfter ?? 1) <= MAX_INLINE_WAIT_S) {
      await sleep((retryAfter ?? 1) * 1000 + 250);
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

export type LibraryPage =
  | { kind: "history"; page: number; pageCount: number; items: [number, string][] }
  | { kind: "ratings"; page: number; pageCount: number; items: [number, number][] }
  | { kind: "watchlist"; page: number; pageCount: number; items: number[] };

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
  const pageCount = Number(headers.get("X-Pagination-Page-Count")) || 1;
  const id = (r: RawLibraryItem) => toMovieRef(r.movie)?.trakt;

  switch (kind) {
    case "history":
      return {
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
        kind,
        page,
        pageCount,
        items: rows.flatMap((r): [number, number][] => {
          const trakt = id(r);
          return trakt && typeof r.rating === "number" ? [[trakt, r.rating]] : [];
        }),
      };
    case "watchlist":
      return { kind, page, pageCount, items: rows.flatMap((r) => id(r) ?? []) };
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
  clientSecret: string;
  redirectUri: string;
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
  const { data } = await traktRequest<unknown>(client.app, "/oauth/token", {
    method: "POST",
    body: {
      client_id: client.app.clientId,
      client_secret: client.clientSecret,
      redirect_uri: client.redirectUri,
      ...grant,
    },
  });
  if (!isTokenResponse(data))
    throw new TraktError(502, "unavailable", "Trakt sent an unexpected token response.");
  return data;
}

export function exchangeCode(client: OAuthClient, code: string): Promise<TokenResponse> {
  return requestToken(client, { code, grant_type: "authorization_code" });
}

export function refreshAccessToken(
  client: OAuthClient,
  refreshToken: string,
): Promise<TokenResponse> {
  return requestToken(client, { refresh_token: refreshToken, grant_type: "refresh_token" });
}

export async function revokeToken(client: OAuthClient, token: string): Promise<void> {
  await traktRequest(client.app, "/oauth/revoke", {
    method: "POST",
    body: { token, client_id: client.app.clientId, client_secret: client.clientSecret },
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
  const { data } = await traktRequest<RawSettings>(app, "/users/settings", { token });
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
