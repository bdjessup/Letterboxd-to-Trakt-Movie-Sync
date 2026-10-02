import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import { ConfigError, getEnv } from "./env";

const base = {
  TRAKT_CLIENT_ID: "id",
  TRAKT_CLIENT_SECRET: "secret",
  SESSION_SECRET: "x".repeat(32),
};

function setEnv(values: Record<string, unknown>) {
  for (const key of Object.keys(env)) delete env[key];
  Object.assign(env, values);
}

afterEach(() => setEnv({}));

describe("getEnv", () => {
  it("defaults to the real Trakt origins", () => {
    setEnv(base);
    expect(getEnv()).toMatchObject({
      TRAKT_API_URL: "https://api.trakt.tv",
      TRAKT_WEB_URL: "https://trakt.tv",
      TRAKT_REDIRECT_URI: undefined,
    });
  });

  it("names every missing secret", () => {
    setEnv({ TRAKT_CLIENT_ID: "id" });
    expect(() => getEnv()).toThrow(/TRAKT_CLIENT_SECRET, SESSION_SECRET/);
  });

  it("requires a long session secret", () => {
    setEnv({ ...base, SESSION_SECRET: "short" });
    expect(() => getEnv()).toThrow(ConfigError);
  });

  it("only allows plain http overrides for localhost", () => {
    setEnv({ ...base, TRAKT_API_URL: "http://localhost:4010/" });
    expect(getEnv().TRAKT_API_URL).toBe("http://localhost:4010");
    setEnv({ ...base, TRAKT_API_URL: "http://example.com" });
    expect(() => getEnv()).toThrow(/https/);
    setEnv({ ...base, TRAKT_WEB_URL: "not a url" });
    expect(() => getEnv()).toThrow(ConfigError);
  });
});
