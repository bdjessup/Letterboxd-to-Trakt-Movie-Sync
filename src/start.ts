import { createCsrfMiddleware, createMiddleware, createStart } from "@tanstack/react-start";

/** Reject cross-site calls to server functions. */
const csrf = createCsrfMiddleware({ filter: (ctx) => ctx.handlerType === "serverFn" });

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  // Start inlines its hydration data; no third-party scripts are allowed.
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = createMiddleware().server(async ({ next, request }) => {
  const result = await next();
  const headers = result.response.headers;
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  if (import.meta.env.PROD) {
    headers.set("Content-Security-Policy", CONTENT_SECURITY_POLICY);
    if (new URL(request.url).protocol === "https:") {
      headers.set("Strict-Transport-Security", "max-age=31536000");
    }
  }
  return result;
});

export const startInstance = createStart(() => ({
  requestMiddleware: [csrf, securityHeaders],
}));
