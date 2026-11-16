import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Resolution, Viewer } from "@/lib/types";
import type { AppEnv } from "./env";
import { resolveFilms } from "./functions";
import { resolveBatch } from "./resolve";
import { withAccessToken } from "./session";
import { TraktError } from "./trakt";

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validate = (data: unknown): unknown => data;
    const builder = {
      validator(fn: typeof validate) {
        validate = fn;
        return builder;
      },
      handler(fn: (input: { data: unknown }) => unknown) {
        return (input: { data?: unknown } = {}) => fn({ data: validate(input.data) });
      },
    };
    return builder;
  },
}));

vi.mock("./env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./env")>()),
  getEnv: vi.fn(),
}));

vi.mock("./resolve", () => ({ resolveBatch: vi.fn() }));
vi.mock("./session", () => ({
  clearSession: vi.fn(),
  oauthClient: vi.fn(),
  readSession: vi.fn(),
  traktApp: () => ({ clientId: "client", apiUrl: "https://api.trakt.tv" }),
  withAccessToken: vi.fn(),
}));

const viewer: Viewer = {
  username: "viewer",
  slug: "viewer",
  name: "Viewer",
  avatarUrl: null,
  timeZone: null,
  vip: false,
};
const films = [
  { title: "One", year: 2001 },
  { title: "Two", year: 2002 },
  { title: "Three", year: 2003 },
];
const one: Resolution = {
  status: "matched",
  confidence: "exact",
  movie: { trakt: 1, slug: "one", title: "One", year: 2001 },
};
const two: Resolution = { status: "not_found" };
const three: Resolution = {
  status: "matched",
  confidence: "likely",
  movie: { trakt: 3, slug: "three", title: "Three", year: 2003 },
};
const expired = { code: "unauthorized", message: "Expired token" } as const;
let refreshFailure: TraktError | null;

async function refreshOnce<T>(
  _env: AppEnv,
  read: (token: string, viewer: Viewer) => Promise<T>,
): Promise<T> {
  try {
    return await read("initial-token", viewer);
  } catch (error) {
    expect(error).toBeInstanceOf(TraktError);
    expect(error).toMatchObject({ status: 401 });
    if (refreshFailure) throw refreshFailure;
    return read("refreshed-token", viewer);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  refreshFailure = null;
  vi.mocked(withAccessToken).mockImplementation(refreshOnce);
  vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

describe("resolveFilms authentication recovery", () => {
  it("returns completed siblings when refreshing the token fails", async () => {
    refreshFailure = new TraktError(401, "unauthorized", "Reconnect Trakt");
    vi.mocked(resolveBatch).mockResolvedValueOnce({
      status: "partial",
      resolutions: [one, null, three],
      calls: 2,
      cacheHits: 1,
      error: expired,
    });

    expect(await resolveFilms({ data: { films } })).toEqual({
      ok: true,
      data: {
        status: "partial",
        resolutions: [one, null, three],
        calls: 2,
        cacheHits: 1,
        error: { code: "unauthorized", message: "Reconnect Trakt", retryAfter: undefined },
      },
    });
    expect(resolveBatch).toHaveBeenCalledTimes(1);
  });

  it("preserves completed results from both attempts when the refreshed token is rejected", async () => {
    vi.mocked(resolveBatch)
      .mockResolvedValueOnce({
        status: "partial",
        resolutions: [one, null, null],
        calls: 1,
        cacheHits: 1,
        error: expired,
      })
      .mockResolvedValueOnce({
        status: "partial",
        resolutions: [two, null],
        calls: 2,
        cacheHits: 0,
        error: expired,
      });

    expect(await resolveFilms({ data: { films } })).toEqual({
      ok: true,
      data: {
        status: "partial",
        resolutions: [one, two, null],
        calls: 3,
        cacheHits: 1,
        error: { ...expired, retryAfter: undefined },
      },
    });
    expect(
      vi.mocked(resolveBatch).mock.calls.map(([, token, batch]) => ({ token, batch })),
    ).toEqual([
      { token: "initial-token", batch: films },
      { token: "refreshed-token", batch: films.slice(1) },
    ]);
  });

  it("refreshes once and retries only unfinished films without changing their result order", async () => {
    vi.mocked(resolveBatch)
      .mockResolvedValueOnce({
        status: "partial",
        resolutions: [one, null, three],
        calls: 1,
        cacheHits: 1,
        error: expired,
      })
      .mockResolvedValueOnce({
        status: "complete",
        resolutions: [two],
        calls: 2,
        cacheHits: 0,
      });

    expect(await resolveFilms({ data: { films } })).toEqual({
      ok: true,
      data: { status: "complete", resolutions: [one, two, three], calls: 3, cacheHits: 1 },
    });
    expect(
      vi.mocked(resolveBatch).mock.calls.map(([, token, batch]) => ({ token, batch })),
    ).toEqual([
      { token: "initial-token", batch: films },
      { token: "refreshed-token", batch: [films[1]] },
    ]);
  });
});
