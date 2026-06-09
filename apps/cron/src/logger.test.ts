import { describe, expect, it } from "vitest";

import { createLogger } from "./logger.js";

describe("createLogger", () => {
  it("emits one JSON line per call with level, name, msg and fields", () => {
    const lines: string[] = [];
    const log = createLogger("cron", {
      sink: (line) => lines.push(line),
      now: () => new Date("2026-06-09T00:00:00.000Z"),
    });

    log.info("hello", { foo: "bar" });

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toEqual({
      level: "info",
      time: "2026-06-09T00:00:00.000Z",
      name: "cron",
      msg: "hello",
      foo: "bar",
    });
  });

  it("filters out messages below the minimum level", () => {
    const lines: string[] = [];
    const log = createLogger("cron", {
      minLevel: "warn",
      sink: (line) => lines.push(line),
    });

    log.debug("ignored");
    log.info("ignored");
    log.warn("kept");
    log.error("kept");

    expect(lines.map((l) => JSON.parse(l).msg)).toEqual(["kept", "kept"]);
  });

  it("produces valid JSON even with no fields", () => {
    const lines: string[] = [];
    const log = createLogger("cron", { sink: (line) => lines.push(line) });

    log.error("oops");

    expect(() => JSON.parse(lines[0]!)).not.toThrow();
  });
});
