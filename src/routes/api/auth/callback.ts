import { createFileRoute } from "@tanstack/react-router";
import { deleteCookie, getCookie } from "@tanstack/react-start/server";
import { getEnv } from "@/server/env";
import {
  OAUTH_STATE_COOKIE,
  OAUTH_VERIFIER_COOKIE,
  oauthClient,
  redirectWithCookies,
  tokensToSession,
  traktApp,
  writeSession,
} from "@/server/session";
import { exchangeCode, fetchViewer, TraktError } from "@/server/trakt";

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const Route = createFileRoute("/api/auth/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const params = new URL(request.url).searchParams;
        const expectedState = getCookie(OAUTH_STATE_COOKIE);
        const codeVerifier = getCookie(OAUTH_VERIFIER_COOKIE);
        deleteCookie(OAUTH_STATE_COOKIE, { path: "/api/auth" });
        deleteCookie(OAUTH_VERIFIER_COOKIE, { path: "/api/auth" });
        const fail = (reason: string) => redirectWithCookies(`/?auth_error=${reason}`);

        if (params.get("error")) return fail("denied");
        const code = params.get("code");
        const state = params.get("state");
        // The state must match the cookie we set before sending the user to Trakt (CSRF).
        if (
          !code ||
          !state ||
          !expectedState ||
          !safeEqual(state, expectedState) ||
          !codeVerifier ||
          !/^[A-Za-z0-9._~-]{43,128}$/.test(codeVerifier)
        ) {
          return fail("state");
        }

        try {
          const env = getEnv();
          const tokens = await exchangeCode(oauthClient(env), code, codeVerifier);
          const viewer = await fetchViewer(traktApp(env), tokens.access_token);
          await writeSession(env, tokensToSession(tokens, viewer));
        } catch (err) {
          console.error({
            event: "trakt_signin_failed",
            message: err instanceof Error ? err.message : "Trakt sign-in failed",
            status: err instanceof TraktError ? err.status : undefined,
            retryAfter: err instanceof TraktError ? err.retryAfter : undefined,
          });
          return fail("exchange");
        }
        return redirectWithCookies("/");
      },
    },
  },
});
