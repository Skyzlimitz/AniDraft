import { describe, expect, it } from "vitest";

import { config, proxy } from "./proxy";

/**
 * Next's matcher is compiled by the framework, but our single pattern is a
 * plain regex group after the leading slash, so anchoring it reproduces the
 * framework's include/exclude behavior closely enough to pin it down.
 */
function matches(pathname: string): boolean {
  return config.matcher.some((pattern) =>
    new RegExp(`^${pattern}$`).test(pathname),
  );
}

describe("proxy", () => {
  it("exports a proxy function for Next's proxy convention", () => {
    expect(typeof proxy).toBe("function");
  });

  it("runs on app routes", () => {
    expect(matches("/")).toBe(true);
    expect(matches("/leagues")).toBe(true);
    expect(matches("/leagues/123/draft")).toBe(true);
  });

  it("skips API routes, including Auth.js's own endpoints", () => {
    expect(matches("/api/auth/session")).toBe(false);
    expect(matches("/api/leagues")).toBe(false);
  });

  it("skips static assets", () => {
    expect(matches("/_next/static/chunks/main.js")).toBe(false);
    expect(matches("/_next/image?url=x")).toBe(false);
    expect(matches("/favicon.ico")).toBe(false);
  });
});
