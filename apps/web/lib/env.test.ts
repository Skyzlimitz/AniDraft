import { describe, expect, it } from "vitest";
import { env } from "./env";

describe("web env", () => {
  it("validates at module load and exposes typed values", () => {
    // Vitest runs with NODE_ENV=test and no app vars set, so the dev/test
    // defaults from webEnvSchema must apply.
    expect(env.NODE_ENV).toBe("test");
    expect(env.NEXT_PUBLIC_REALTIME_URL).toBe("ws://localhost:4000");
    expect(env.VERCEL_URL).toBeUndefined();
  });
});
