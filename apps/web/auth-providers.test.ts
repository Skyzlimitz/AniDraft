import { describe, expect, it } from "vitest";
import type { DiscordProfile } from "next-auth/providers/discord";
import type { GoogleProfile } from "next-auth/providers/google";

import {
  discordAvatarUrl,
  mapDiscordProfile,
  mapGoogleProfile,
  oauthProviders,
} from "./auth-providers";

function googleProfile(overrides: Partial<GoogleProfile> = {}): GoogleProfile {
  return {
    aud: "aud",
    azp: "azp",
    email: "captain@anidraft.test",
    email_verified: true,
    exp: 0,
    given_name: "Captain",
    iat: 0,
    iss: "https://accounts.google.com",
    name: "Captain Anidraft",
    picture: "https://lh3.googleusercontent.com/a/pic",
    sub: "google-sub-123",
    ...overrides,
  };
}

function discordProfile(
  overrides: Partial<DiscordProfile> = {},
): DiscordProfile {
  return {
    id: "1234567890",
    username: "captain",
    discriminator: "0",
    global_name: "Captain",
    avatar: "abc123",
    mfa_enabled: false,
    banner: null,
    accent_color: null,
    locale: "en-US",
    verified: true,
    email: "captain@anidraft.test",
    flags: 0,
    ...overrides,
  } as DiscordProfile;
}

describe("mapGoogleProfile", () => {
  it("maps sub→id, name, email and picture→image", () => {
    expect(mapGoogleProfile(googleProfile())).toEqual({
      id: "google-sub-123",
      name: "Captain Anidraft",
      email: "captain@anidraft.test",
      image: "https://lh3.googleusercontent.com/a/pic",
    });
  });
});

describe("discordAvatarUrl", () => {
  it("builds a PNG URL for a static avatar hash", () => {
    expect(discordAvatarUrl(discordProfile({ avatar: "abc123" }))).toBe(
      "https://cdn.discordapp.com/avatars/1234567890/abc123.png",
    );
  });

  it("builds a GIF URL for an animated avatar hash (a_ prefix)", () => {
    expect(discordAvatarUrl(discordProfile({ avatar: "a_xyz" }))).toBe(
      "https://cdn.discordapp.com/avatars/1234567890/a_xyz.gif",
    );
  });

  it("falls back to an embed avatar from the snowflake for new usernames", () => {
    // discriminator "0" → (id >> 22) % 6. 1234567890 >> 22 = 294, 294 % 6 = 0.
    expect(
      discordAvatarUrl(discordProfile({ avatar: null, discriminator: "0" })),
    ).toBe("https://cdn.discordapp.com/embed/avatars/0.png");
  });

  it("falls back to an embed avatar from the legacy discriminator", () => {
    // discriminator "7" → 7 % 5 = 2.
    expect(
      discordAvatarUrl(discordProfile({ avatar: null, discriminator: "7" })),
    ).toBe("https://cdn.discordapp.com/embed/avatars/2.png");
  });
});

describe("mapDiscordProfile", () => {
  it("prefers global_name and resolves the avatar URL", () => {
    expect(mapDiscordProfile(discordProfile({ global_name: "Cap" }))).toEqual({
      id: "1234567890",
      name: "Cap",
      email: "captain@anidraft.test",
      image: "https://cdn.discordapp.com/avatars/1234567890/abc123.png",
    });
  });

  it("falls back to username when global_name is null", () => {
    expect(
      mapDiscordProfile(discordProfile({ global_name: null })).name,
    ).toBe("captain");
  });
});

describe("oauthProviders", () => {
  it("registers exactly the Google and Discord providers", () => {
    const ids = oauthProviders.map((provider) =>
      typeof provider === "function" ? provider().id : provider.id,
    );
    expect(ids).toEqual(["google", "discord"]);
  });
});
