import { describe, expect, it } from "vitest";

import { authConfig } from "./auth.config";

describe("authConfig", () => {
  it("has no providers yet (Google #21 / Discord #22 are separate issues)", () => {
    expect(authConfig.providers).toEqual([]);
  });

  it("uses the JWT session strategy explicitly", () => {
    expect(authConfig.session.strategy).toBe("jwt");
  });

  it("session callback copies token.sub onto session.user.id", async () => {
    const session = {
      user: {
        id: "",
        name: null,
        email: "captain@anidraft.test",
        emailVerified: null,
        image: null,
      },
      sessionToken: "",
      userId: "",
      expires: new Date(Date.now() + 60_000) as Date & string,
    };

    const result = await authConfig.callbacks.session({
      session,
      token: { sub: "user-123" },
    } as unknown as Parameters<typeof authConfig.callbacks.session>[0]);

    expect(result?.user?.id).toBe("user-123");
  });

  it("session callback leaves session.user.id alone when the token has no sub", async () => {
    const session = {
      user: {
        id: "preexisting",
        name: null,
        email: "captain@anidraft.test",
        emailVerified: null,
        image: null,
      },
      sessionToken: "",
      userId: "",
      expires: new Date(Date.now() + 60_000) as Date & string,
    };

    const result = await authConfig.callbacks.session({
      session,
      token: {},
    } as unknown as Parameters<typeof authConfig.callbacks.session>[0]);

    expect(result?.user?.id).toBe("preexisting");
  });
});
