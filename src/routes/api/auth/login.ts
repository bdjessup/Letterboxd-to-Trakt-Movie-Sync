import { createFileRoute } from "@tanstack/react-router";
import { setCookie } from "@tanstack/react-start/server";
import { getEnv } from "@/server/env";
import {
  isSecureRequest,
  OAUTH_STATE_COOKIE,
  redirectUri,
  redirectWithCookies,
} from "@/server/session";

function randomState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export const Route = createFileRoute("/api/auth/login")({
  server: {
    handlers: {
      GET: () => {
        let env: ReturnType<typeof getEnv>;
        try {
          env = getEnv();
        } catch (err) {
          console.error(err);
          return redirectWithCookies("/?auth_error=config");
        }

        const state = randomState();
        setCookie(OAUTH_STATE_COOKIE, state, {
          httpOnly: true,
          secure: isSecureRequest(),
          sameSite: "lax",
          path: "/api/auth",
          maxAge: 600,
        });

        const url = new URL("/oauth/authorize", env.TRAKT_WEB_URL);
        url.searchParams.set("response_type", "code");
        url.searchParams.set("client_id", env.TRAKT_CLIENT_ID);
        url.searchParams.set("redirect_uri", redirectUri(env));
        url.searchParams.set("state", state);
        return redirectWithCookies(url.toString());
      },
    },
  },
});
