import { describe, expect, it } from "vitest";
import {
  DEV_DATABASE_URL,
  cronEnvSchema,
  parseEnv,
  realtimeEnvSchema,
  webEnvSchema,
} from "./env.js";

describe("parseEnv", () => {
  it("parses a valid environment and applies defaults", () => {
    const env = parseEnv(realtimeEnvSchema, {});
    expect(env).toEqual({
      NODE_ENV: "development",
      PORT: 4000,
      DATABASE_URL: DEV_DATABASE_URL,
    });
  });

  it("treats empty-string values as unset (dotenv `VAR=` lines)", () => {
    const env = parseEnv(realtimeEnvSchema, {
      PORT: "",
      DATABASE_AUTH_TOKEN: "",
    });
    expect(env.PORT).toBe(4000);
    expect(env.DATABASE_AUTH_TOKEN).toBeUndefined();
  });

  it("ignores unrelated variables in the source", () => {
    const env = parseEnv(realtimeEnvSchema, { HOME: "/root", PORT: "5001" });
    expect(env.PORT).toBe(5001);
    expect(env).not.toHaveProperty("HOME");
  });

  it("aggregates every failure into one error message", () => {
    expect(() =>
      parseEnv(cronEnvSchema, {
        NODE_ENV: "staging",
        LOG_LEVEL: "verbose",
      }),
    ).toThrowError(
      /Invalid environment variables:[\s\S]*NODE_ENV:[\s\S]*LOG_LEVEL:/,
    );
  });

  it("points the reader at .env.example and docs/env-vars.md", () => {
    expect(() =>
      parseEnv(realtimeEnvSchema, { PORT: "abc" }),
    ).toThrowError(/\.env\.example and docs\/env-vars\.md/);
  });
});

describe("realtimeEnvSchema", () => {
  it("coerces PORT to a number", () => {
    expect(parseEnv(realtimeEnvSchema, { PORT: "8080" }).PORT).toBe(8080);
  });

  it("rejects a malformed PORT in every environment", () => {
    expect(() => parseEnv(realtimeEnvSchema, { PORT: "abc" })).toThrowError(
      /PORT: must be a port number/,
    );
    expect(() => parseEnv(realtimeEnvSchema, { PORT: "70000" })).toThrowError(
      /PORT: must be between 1 and 65535/,
    );
  });

  it("requires DATABASE_URL in production", () => {
    expect(() =>
      parseEnv(realtimeEnvSchema, { NODE_ENV: "production" }),
    ).toThrowError(/DATABASE_URL: required in production/);
  });

  it("accepts a full production environment", () => {
    const env = parseEnv(realtimeEnvSchema, {
      NODE_ENV: "production",
      PORT: "4000",
      DATABASE_URL: "libsql://anidraft.turso.io",
      DATABASE_AUTH_TOKEN: "token",
    });
    expect(env.DATABASE_URL).toBe("libsql://anidraft.turso.io");
    expect(env.DATABASE_AUTH_TOKEN).toBe("token");
  });
});

describe("cronEnvSchema", () => {
  it("defaults LOG_LEVEL to info and DATABASE_URL to the dev file", () => {
    const env = parseEnv(cronEnvSchema, {});
    expect(env.LOG_LEVEL).toBe("info");
    expect(env.DATABASE_URL).toBe(DEV_DATABASE_URL);
  });

  it("rejects an unknown LOG_LEVEL", () => {
    expect(() =>
      parseEnv(cronEnvSchema, { LOG_LEVEL: "verbose" }),
    ).toThrowError(/LOG_LEVEL:/);
  });

  it("requires DATABASE_URL in production", () => {
    expect(() =>
      parseEnv(cronEnvSchema, { NODE_ENV: "production" }),
    ).toThrowError(/DATABASE_URL: required in production/);
  });
});

describe("webEnvSchema", () => {
  it("defaults NEXT_PUBLIC_REALTIME_URL to the local realtime server", () => {
    const env = parseEnv(webEnvSchema, {});
    expect(env.NEXT_PUBLIC_REALTIME_URL).toBe("ws://localhost:4000");
  });

  it("rejects a malformed NEXT_PUBLIC_REALTIME_URL", () => {
    expect(() =>
      parseEnv(webEnvSchema, { NEXT_PUBLIC_REALTIME_URL: "not a url" }),
    ).toThrowError(/NEXT_PUBLIC_REALTIME_URL: must be a URL/);
  });

  it("requires NEXT_PUBLIC_REALTIME_URL in production", () => {
    expect(() =>
      parseEnv(webEnvSchema, { NODE_ENV: "production" }),
    ).toThrowError(/NEXT_PUBLIC_REALTIME_URL: required in production/);
  });

  it("keeps VERCEL_URL optional everywhere", () => {
    const env = parseEnv(webEnvSchema, {
      NODE_ENV: "production",
      NEXT_PUBLIC_REALTIME_URL: "wss://realtime.anidraft.app",
      AUTH_SECRET: "test-secret",
      DATABASE_URL: "libsql://anidraft.turso.io",
    });
    expect(env.VERCEL_URL).toBeUndefined();
  });

  it("keeps the OAuth client credentials optional at boot, even in production", () => {
    // They are only read during a provider's OAuth handshake, so a build
    // without them must succeed (the provider's sign-in just fails later).
    const env = parseEnv(webEnvSchema, {
      NODE_ENV: "production",
      NEXT_PUBLIC_REALTIME_URL: "wss://realtime.anidraft.app",
      AUTH_SECRET: "test-secret",
      DATABASE_URL: "libsql://anidraft.turso.io",
    });
    expect(env.GOOGLE_CLIENT_ID).toBeUndefined();
    expect(env.DISCORD_CLIENT_SECRET).toBeUndefined();
  });

  it("parses the OAuth client credentials when present", () => {
    const env = parseEnv(webEnvSchema, {
      GOOGLE_CLIENT_ID: "google-id",
      GOOGLE_CLIENT_SECRET: "google-secret",
      DISCORD_CLIENT_ID: "discord-id",
      DISCORD_CLIENT_SECRET: "discord-secret",
    });
    expect(env.GOOGLE_CLIENT_ID).toBe("google-id");
    expect(env.DISCORD_CLIENT_ID).toBe("discord-id");
  });

  it("defaults DATABASE_URL to the local file db in development", () => {
    const env = parseEnv(webEnvSchema, {});
    expect(env.DATABASE_URL).toBe("file:./dev.db");
  });

  it("requires AUTH_SECRET and DATABASE_URL in production", () => {
    expect(() =>
      parseEnv(webEnvSchema, {
        NODE_ENV: "production",
        NEXT_PUBLIC_REALTIME_URL: "wss://realtime.anidraft.app",
      }),
    ).toThrowError(
      /AUTH_SECRET: required in production[\s\S]*DATABASE_URL: required in production/,
    );
  });

  it("keeps AUTH_URL optional but rejects a malformed value", () => {
    expect(parseEnv(webEnvSchema, {}).AUTH_URL).toBeUndefined();
    expect(() =>
      parseEnv(webEnvSchema, { AUTH_URL: "not a url" }),
    ).toThrowError(/AUTH_URL: must be a URL/);
  });
});
