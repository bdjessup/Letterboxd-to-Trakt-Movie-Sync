# Letterboxd → Trakt

Copy your Letterboxd diary, ratings and watchlist to [Trakt](https://trakt.tv). Upload the export ZIP, review every change, then sync. Run it again whenever you've logged more films. Only new entries are added.

Built with [TanStack Start](https://tanstack.com/start) and deployed to [Cloudflare Workers](https://developers.cloudflare.com/workers/).

## What it does

- **Watch history, rewatches included.** Every diary entry becomes a play on the date you logged it.
- **No duplicates.** Before anything is sent, your Trakt history is read. An entry is skipped when that film already has a play on the same day (in your Trakt time zone), and each existing play can only cover one entry.
- **Ratings.** Letterboxd half-stars double to Trakt's 1–10 scale (★★★½ → 7). Ratings that differ from Trakt's are kept unless you choose to replace them.
- **Watchlist.** Films go to your Trakt watchlist unless they're already there or already watched.
- **Optional: films without a diary date.** Films you marked watched without logging can be added, dated to the day you marked them.
- **Review first.** Changes are grouped into *To sync*, *Check matches* (fuzzy title or year matches, left out until you tick them), *Not found* (fix by searching Trakt by hand) and *Up to date*.
- **Resumable.** Progress and film matches are saved in your browser (IndexedDB), so a reload or re-connect picks up where you left off, and later runs take seconds.

## How it works

1. The export is parsed **in the browser**. It's never uploaded anywhere. `diary.csv`, `ratings.csv`, `watched.csv` and `watchlist.csv` are read; the `deleted/` and `orphaned/` folders are ignored.
2. The Worker reads your Trakt history, ratings and watchlist page by page.
3. Each film is matched with Trakt's search, filtered by year first and then without the year to catch off-by-one release dates. Exact matches are cached at the edge for 30 days and shared between users.
4. The app works out the changes (`src/lib/plan.ts`) and shows them for review.
5. Approved changes are sent in batches of 100, at most one write per second.

Trakt allows each user about 1,000 reads per five minutes and one write per second. Matching runs at about three requests per second and backs off automatically when Trakt asks it to (HTTP 429). Writes are never retried after an ambiguous failure, because they could already have been applied. Running the check again shows what landed.

## Security and privacy

- Trakt tokens never reach the browser. They're kept in an encrypted (AES-256-CBC + HMAC), `HttpOnly`, `SameSite=Lax` session cookie, refreshed before they expire, and revoked on sign-out.
- OAuth uses a one-time `state` value to prevent login CSRF. Server functions are protected by TanStack Start's CSRF middleware.
- The server only calls fixed Trakt endpoints with validated input. There's no general-purpose proxy.
- Responses carry a Content Security Policy, `X-Frame-Options: DENY`, `nosniff`, HSTS and related headers.
- Nothing about your library is stored on the server.

## Deploy your own

### 1. Create a Trakt app

Go to <https://trakt.tv/oauth/applications/new> and add these **Redirect URIs** (one per line):

```
https://<your-domain>/api/auth/callback
http://localhost:3000/api/auth/callback
```

Note the **Client ID** and **Client Secret**.

### 2. Run it locally

Requires Node 22+.

```bash
npm install
cp .dev.vars.example .dev.vars   # then fill in the three values
npm run dev                       # http://localhost:3000
```

Generate `SESSION_SECRET` with `openssl rand -base64 32`.

### 3. Deploy to Cloudflare

```bash
npx wrangler login
npx wrangler secret put TRAKT_CLIENT_ID
npx wrangler secret put TRAKT_CLIENT_SECRET
npx wrangler secret put SESSION_SECRET
npm run deploy
```

Or connect the repository in the Cloudflare dashboard (**Workers & Pages → Create → Import a repository**) to deploy on every push, and add the three secrets under **Settings → Variables and Secrets**.

Use a [custom domain](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/) in production. Cloudflare documents the Cache API, which shares film matches between users, as functional on custom domains. On a `workers.dev` URL the app still works, just without that shared cache.

### Configuration

| Name | Required | Description |
| --- | --- | --- |
| `TRAKT_CLIENT_ID` | yes | Trakt app client ID |
| `TRAKT_CLIENT_SECRET` | yes | Trakt app client secret |
| `SESSION_SECRET` | yes | 32+ random characters used to encrypt the session cookie. Changing it signs everyone out. |
| `TRAKT_REDIRECT_URI` | no | Defaults to `<request origin>/api/auth/callback` |
| `TRAKT_API_URL`, `TRAKT_WEB_URL` | no | Only for testing against a mock (see below) |

## Try it without Trakt credentials

`scripts/mock-trakt.mjs` is a small in-memory stand-in for the Trakt API, covering OAuth, search, library pages and sync, with small pages and a deliberate 429 so those code paths get exercised.

```bash
npm run mock:trakt
```

Then put this in `.dev.vars` and run `npm run dev`:

```
TRAKT_CLIENT_ID=mock
TRAKT_CLIENT_SECRET=mock
SESSION_SECRET=any-string-of-at-least-32-characters
TRAKT_API_URL=http://localhost:4010
TRAKT_WEB_URL=http://localhost:4010
```

## Development

| Command | |
| --- | --- |
| `npm run dev` | Dev server on the Workers runtime (via the Cloudflare Vite plugin) |
| `npm run check` | Lint (Biome), typecheck and unit tests, the same as CI |
| `npm test` | Unit tests (Vitest) |
| `npm run format` | Format and fix lint issues |
| `npm run build` | Production build |
| `npm run deploy` | Build and deploy with Wrangler |

```
src/
  routes/            Pages and the OAuth routes (api/auth/login, api/auth/callback)
  server/            Worker-only code: Trakt client, session, validation, server functions
  lib/               Shared logic: export parsing, matching, the sync plan, dates
  hooks/             useSyncEngine, which runs analyze and sync in the browser
  components/        UI
scripts/mock-trakt.mjs
```

The logic that decides what gets synced lives in `src/lib/plan.ts` and is covered by `src/lib/plan.test.ts`.

## Limitations

- Letterboxd exports contain titles and years, not TMDB or IMDb IDs, so matching relies on Trakt's search. Translated titles, re-releases and shorts sometimes need a manual fix.
- Free Trakt accounts have item limits on some lists. When Trakt reports a limit (HTTP 420), the app says so and skips that list.
- TV shows and episodes aren't synced. Letterboxd only tracks films.

## License

MIT. Not affiliated with Letterboxd or Trakt.
