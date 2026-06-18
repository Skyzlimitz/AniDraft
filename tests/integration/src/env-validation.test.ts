import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  cronEnvKeys,
  cronEnvSchema,
  parseEnv,
  realtimeEnvKeys,
  realtimeEnvSchema,
  webEnvKeys,
  webEnvSchema,
} from "@anidraft/shared";
import type { EnvSource } from "@anidraft/shared";

/**
 * shared ↔ apps boundary: every app's `.env.example` must parse against the
 * app's schema in `packages/shared/src/env.ts`, so the committed examples can
 * never drift from what the apps actually validate at boot (issue #9).
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");

function readEnvExample(app: string): EnvSource {
  const raw = readFileSync(join(repoRoot, "apps", app, ".env.example"), "utf8");
  const env: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    expect(eq, `malformed line in apps/${app}/.env.example: ${line}`).toBeGreaterThan(0);
    env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return env;
}

describe("each .env.example parses against its app schema", () => {
  it("apps/web", () => {
    const env = parseEnv(webEnvSchema, readEnvExample("web"));
    expect(env.NEXT_PUBLIC_REALTIME_URL).toBe("ws://localhost:4000");
  });

  it("apps/realtime", () => {
    const env = parseEnv(realtimeEnvSchema, readEnvExample("realtime"));
    expect(env.PORT).toBe(4000);
    expect(env.DATABASE_URL).toBe("file:./dev.db");
  });

  it("apps/cron", () => {
    const env = parseEnv(cronEnvSchema, readEnvExample("cron"));
    expect(env.LOG_LEVEL).toBe("info");
    expect(env.DATABASE_URL).toBe("file:./dev.db");
  });
});

describe("every .env.example documents every schema key", () => {
  const cases = [
    { app: "web", keys: webEnvKeys },
    { app: "realtime", keys: realtimeEnvKeys },
    { app: "cron", keys: cronEnvKeys },
  ] as const;

  for (const { app, keys } of cases) {
    it(`apps/${app}`, () => {
      const documented = Object.keys(readEnvExample(app));
      expect(documented.sort()).toEqual([...keys].sort());
    });
  }
});

describe("boot fails in production when a required variable is missing", () => {
  it("realtime requires DATABASE_URL", () => {
    expect(() =>
      parseEnv(realtimeEnvSchema, { NODE_ENV: "production" }),
    ).toThrowError(/DATABASE_URL: required in production/);
  });

  it("cron requires DATABASE_URL", () => {
    expect(() =>
      parseEnv(cronEnvSchema, { NODE_ENV: "production" }),
    ).toThrowError(/DATABASE_URL: required in production/);
  });

  it("web requires NEXT_PUBLIC_REALTIME_URL", () => {
    expect(() =>
      parseEnv(webEnvSchema, { NODE_ENV: "production" }),
    ).toThrowError(/NEXT_PUBLIC_REALTIME_URL: required in production/);
  });

  it("web requires AUTH_SECRET and DATABASE_URL (Auth.js + Drizzle adapter)", () => {
    expect(() =>
      parseEnv(webEnvSchema, { NODE_ENV: "production" }),
    ).toThrowError(
      /AUTH_SECRET: required in production[\s\S]*DATABASE_URL: required in production/,
    );
  });
});
