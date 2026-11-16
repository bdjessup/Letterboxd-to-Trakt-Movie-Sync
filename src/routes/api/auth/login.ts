import { createFileRoute } from "@tanstack/react-router";
import { setCookie } from "@tanstack/react-start/server";
import { getEnv } from "@/server/env";
import {
  isSecureRequest,
  OAUTH_STATE_COOKIE,
  OAUTH_VERIFIER_COOKIE,
  oauthClient,
  redirectWithCookies,
} from "@/server/session";
import { createAuthorizationRequest } from "@/server/trakt";

export const Route = createFileRoute("/api/auth/login")({
  server: {
    handlers: {
      GET: async () => {
        let env: ReturnType<typeof getEnv>;
        try {
          env = getEnv();
        } catch (err) {
          console.error(err);
          return redirectWithCookies("/?auth_error=config");
        }

        const { authorizeUrl, state, codeVerifier } = await createAuthorizationRequest(
          oauthClient(env),
        );
        const cookieOptions = {
          httpOnly: true,
          secure: isSecureRequest(),
          sameSite: "lax" as const,
          path: "/api/auth",
          maxAge: 600,
        };
        setCookie(OAUTH_STATE_COOKIE, state, cookieOptions);
        setCookie(OAUTH_VERIFIER_COOKIE, codeVerifier, cookieOptions);
        return redirectWithCookies(authorizeUrl);
      },
    },
  },
});
