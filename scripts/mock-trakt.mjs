#!/usr/bin/env node
// A tiny stand-in for the Trakt API, for trying the app locally without Trakt credentials.
//
//   npm run mock:trakt
//
// Then run the app with these in .dev.vars:
//   TRAKT_CLIENT_ID=mock
//   TRAKT_CLIENT_SECRET=mock
//   SESSION_SECRET=<any 32+ characters>
//   TRAKT_API_URL=http://localhost:4010
//   TRAKT_WEB_URL=http://localhost:4010
//
// State lives in memory and resets when the process restarts. Pages are deliberately small
// and the fifth search is rate limited, so pagination and back-off get exercised.
import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 4010);
const PAGE_LIMIT = 3;
const TOKEN = "mock-access-token";

const catalog = [
  ["Heat", 1995],
  ["Dune", 2021],
  ["Dune", 1984],
  ["Past Lives", 2023],
  ["Oldboy", 2003],
  ["Parasite", 2019],
  ["Spirited Away", 2001, ["Sen to Chihiro no Kamikakushi"]],
  ["Amélie", 2001],
  ["Crouching Tiger, Hidden Dragon", 2000],
  ["The Matrix", 1999],
  ["Suspiria", 1977],
  ["Suspiria", 2018],
  ["Everything Everywhere All at Once", 2022],
  ["Portrait of a Lady on Fire", 2019],
  ["In the Mood for Love", 2000],
  ["Mad Max: Fury Road", 2015],
  ["Paddington 2", 2017],
  ["Aftersun", 2022],
  ["The Godfather", 1972],
  ["Perfect Days", 2023],
  ...Array.from({ length: 40 }, (_, i) => [`Sample Film ${i + 1}`, 1960 + i]),
].map(([title, year, aliases = []], i) => ({
  title,
  year,
  aliases,
  ids: {
    trakt: 1000 + i,
    slug: `${title}-${year}`.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    imdb: `tt${String(1000000 + i)}`,
    tmdb: 5000 + i,
  },
}));

const byId = new Map(catalog.map((m) => [m.ids.trakt, m]));
const find = (title, year) => catalog.find((m) => m.title === title && m.year === year);
const movieJson = ({ title, year, ids }) => ({ title, year, ids });

// The signed-in user's library.
const library = {
  history: [
    { id: 1, movie: find("Heat", 1995), watched_at: "2024-01-01T00:00:00.000Z" },
    { id: 2, movie: find("Dune", 2021), watched_at: "2024-02-10T05:00:00.000Z" },
  ],
  ratings: new Map([
    [find("Heat", 1995).ids.trakt, 10],
    [find("Dune", 2021).ids.trakt, 6],
  ]),
  watchlist: new Set([find("The Matrix", 1999).ids.trakt]),
};

let searches = 0;
let lastWrite = 0;

const normalize = (s) =>
  s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(body === undefined ? "" : JSON.stringify(body));
}

function paginate(res, url, items) {
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
  const limit = Math.min(PAGE_LIMIT, Number(url.searchParams.get("limit") ?? 10));
  const pageCount = Math.max(1, Math.ceil(items.length / limit));
  send(res, 200, items.slice((page - 1) * limit, page * limit), {
    "X-Pagination-Page": String(page),
    "X-Pagination-Limit": String(limit),
    "X-Pagination-Page-Count": String(pageCount),
    "X-Pagination-Item-Count": String(items.length),
  });
}

async function readJson(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  console.log(`${new Date().toISOString().slice(11, 23)} ${req.method} ${path}${url.search}`);

  // OAuth consent page: approve immediately.
  if (path === "/oauth/authorize") {
    const back = new URL(url.searchParams.get("redirect_uri"));
    back.searchParams.set("code", "mock-code");
    back.searchParams.set("state", url.searchParams.get("state") ?? "");
    res.writeHead(302, { Location: back.toString() });
    return res.end();
  }

  if (req.headers["trakt-api-version"] !== "2" || !req.headers["trakt-api-key"]) {
    return send(res, 403, { error: "missing api headers" });
  }

  if (path === "/oauth/token" && req.method === "POST") {
    const body = await readJson(req);
    if (body.code !== "mock-code" && body.refresh_token !== "mock-refresh-token") {
      return send(res, 401, { error: "invalid_grant" });
    }
    return send(res, 200, {
      access_token: TOKEN,
      refresh_token: "mock-refresh-token",
      expires_in: 86400,
      created_at: Math.floor(Date.now() / 1000),
      token_type: "bearer",
      scope: "public",
    });
  }
  if (path === "/oauth/revoke") return send(res, 200, {});

  if (req.headers.authorization !== `Bearer ${TOKEN}`) {
    return send(res, 401, { error: "invalid token" });
  }

  if (path === "/users/settings") {
    return send(res, 200, {
      user: {
        username: "cinephile",
        name: "Cine Phile",
        vip: false,
        ids: { slug: "cinephile" },
        images: { avatar: { full: "" } },
      },
      account: { timezone: "America/Los_Angeles" },
    });
  }

  if (path === "/search/movie") {
    searches++;
    if (searches === 5) return send(res, 429, { error: "slow down" }, { "Retry-After": "1" });
    const q = normalize(url.searchParams.get("query") ?? "");
    const years = url.searchParams.get("years");
    const hits = catalog.filter(
      (m) =>
        (!years || String(m.year) === years) &&
        [m.title, ...m.aliases].some((t) => normalize(t).includes(q) || q.includes(normalize(t))),
    );
    return send(
      res,
      200,
      hits.slice(0, 10).map((m) => ({ type: "movie", score: 100, movie: movieJson(m) })),
    );
  }

  if (path === "/sync/history/movies") {
    const rows = library.history.map((h) => ({
      id: h.id,
      watched_at: h.watched_at,
      action: "watch",
      type: "movie",
      movie: movieJson(h.movie),
    }));
    return paginate(res, url, rows);
  }
  if (path === "/sync/ratings/movies") {
    const rows = [...library.ratings].map(([id, rating]) => ({
      rating,
      type: "movie",
      movie: movieJson(byId.get(id)),
    }));
    return paginate(res, url, rows);
  }
  if (path === "/sync/watchlist/movies") {
    const rows = [...library.watchlist].map((id) => ({
      type: "movie",
      movie: movieJson(byId.get(id)),
    }));
    return paginate(res, url, rows);
  }

  if (
    req.method === "POST" &&
    ["/sync/history", "/sync/ratings", "/sync/watchlist"].includes(path)
  ) {
    const gap = Date.now() - lastWrite;
    lastWrite = Date.now();
    if (gap < 1000) console.warn(`  ! writes only ${gap}ms apart`);
    const { movies = [] } = await readJson(req);
    const notFound = [];
    let added = 0;
    let existing = 0;
    for (const item of movies) {
      const movie = byId.get(item.ids?.trakt);
      if (!movie) {
        notFound.push({ ids: item.ids });
        continue;
      }
      if (path === "/sync/history") {
        library.history.push({
          id: library.history.length + 1,
          movie,
          watched_at: item.watched_at,
        });
        added++;
      } else if (path === "/sync/ratings") {
        library.ratings.set(movie.ids.trakt, item.rating);
        added++;
      } else if (library.watchlist.has(movie.ids.trakt)) {
        existing++;
      } else {
        library.watchlist.add(movie.ids.trakt);
        added++;
      }
    }
    console.log(`  → added ${added}, existing ${existing}, not found ${notFound.length}`);
    return send(res, 201, {
      added: { movies: added, episodes: 0 },
      existing: { movies: existing, episodes: 0 },
      not_found: { movies: notFound, shows: [], seasons: [], episodes: [] },
    });
  }

  send(res, 404, { error: "not found" });
});

server.listen(PORT, () => console.log(`Mock Trakt API listening on http://localhost:${PORT}`));
