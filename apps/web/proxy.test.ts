import { describe, expect, it } from "vitest";

import {
  config,
  decideProxyAction,
  isPublicRoute,
  proxy,
  PUBLIC_ROUTES,
} from "./proxy";

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

describe("isPublicRoute", () => {
  it("treats the landing page and sign-in page as public", () => {
    for (const route of PUBLIC_ROUTES) {
      expect(isPublicRoute(route)).toBe(true);
    }
    expect(isPublicRoute("/")).toBe(true);
    expect(isPublicRoute("/sign-in")).toBe(true);
  });

  it("treats everything else as protected (deny-by-default)", () => {
    expect(isPublicRoute("/leagues")).toBe(false);
    expect(isPublicRoute("/leagues/123/draft")).toBe(false);
    expect(isPublicRoute("/settings")).toBe(false);
    // Not a prefix match: a path that merely starts with a public route is
    // still protected.
    expect(isPublicRoute("/sign-in-now")).toBe(false);
    expect(isPublicRoute("/leagues/")).toBe(false);
  });
});

describe("decideProxyAction", () => {
  it("lets authenticated users reach any route", () => {
    expect(decideProxyAction("/leagues", true)).toEqual({ type: "next" });
    expect(decideProxyAction("/leagues/123/draft", true)).toEqual({
      type: "next",
    });
    expect(decideProxyAction("/", true)).toEqual({ type: "next" });
  });

  it("lets unauthenticated users reach public routes", () => {
    expect(decideProxyAction("/", false)).toEqual({ type: "next" });
    expect(decideProxyAction("/sign-in", false)).toEqual({ type: "next" });
  });

  it("redirects unauthenticated users off protected routes with a callbackUrl", () => {
    expect(decideProxyAction("/leagues", false)).toEqual({
      type: "redirect",
      location: "/sign-in?callbackUrl=%2Fleagues",
    });
    expect(decideProxyAction("/leagues/123/draft", false)).toEqual({
      type: "redirect",
      location: "/sign-in?callbackUrl=%2Fleagues%2F123%2Fdraft",
    });
  });

  it("percent-encodes path characters that are unsafe in a query value", () => {
    // `&` and `=` are legal in a URL path but special in a query string;
    // encoding keeps them from corrupting the `callbackUrl` param.
    const { location } = decideProxyAction("/a&b=c", false) as {
      type: "redirect";
      location: string;
    };
    expect(location).toBe("/sign-in?callbackUrl=%2Fa%26b%3Dc");
    // Round-trips back to the original path for the eventual consumer.
    const callbackUrl = new URLSearchParams(location.split("?")[1]).get(
      "callbackUrl",
    );
    expect(callbackUrl).toBe("/a&b=c");
  });

  it("never redirects to sign-in from sign-in (no loop)", () => {
    expect(decideProxyAction("/sign-in", false)).toEqual({ type: "next" });
  });
});
