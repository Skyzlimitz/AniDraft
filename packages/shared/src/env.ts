import { z } from "zod";

/**
 * Typed environment validation — the single source of truth for every
 * environment variable AniDraft apps read. See `docs/env-vars.md` for the
 * full convention and per-environment sourcing.
 *
 * Rules:
 * - UPPER_SNAKE_CASE, no per-app prefixes (each app deploys to an isolated
 *   platform env). The only prefix is Next.js's mandated `NEXT_PUBLIC_` for
 *   client-exposed web variables.
 * - Shared resources keep identical names across apps (`DATABASE_URL`,
 *   `DATABASE_AUTH_TOKEN`).
 * - Apps call `parseEnv(<app>EnvSchema)` exactly once at boot and pass the
 *   typed result down — no scattered `process.env` reads in app code.
 * - Values with a safe local fallback default in development; secrets are
 *   required in production so a misconfigured deploy fails at boot, loudly.
 */

export const nodeEnvSchema = z
  .enum(["development", "test", "production"])
  .default("development");

export type NodeEnv = z.infer<typeof nodeEnvSchema>;

export const logLevelSchema = z.enum(["debug", "info", "warn", "error"]);

export type LogLevel = z.infer<typeof logLevelSchema>;

/** TCP port given as a numeric string (env values are always strings). */
export const portSchema = z
  .string()
  .regex(/^\d+$/, "must be a port number (e.g. 4000)")
  .transform(Number)
  .pipe(
    z
      .number()
      .int()
      .min(1, "must be between 1 and 65535")
      .max(65535, "must be between 1 and 65535"),
  );

/** Local libSQL file used when DATABASE_URL is unset in development. */
export const DEV_DATABASE_URL = "file:./dev.db";

const databaseShape = {
  NODE_ENV: nodeEnvSchema,
  DATABASE_URL: z.string().min(1).optional(),
  DATABASE_AUTH_TOKEN: z.string().min(1).optional(),
};

type DatabaseEnvBase = {
  NODE_ENV: NodeEnv;
  DATABASE_URL?: string;
  DATABASE_AUTH_TOKEN?: string;
};

function requireDatabaseUrlInProduction(
  env: DatabaseEnvBase,
  ctx: z.RefinementCtx,
): void {
  if (env.NODE_ENV === "production" && env.DATABASE_URL === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["DATABASE_URL"],
      message:
        "required in production — set it as a Fly secret (see docs/env-vars.md)",
    });
  }
}

function applyDevDatabaseDefault<T extends DatabaseEnvBase>(
  env: T,
): T & { DATABASE_URL: string } {
  return { ...env, DATABASE_URL: env.DATABASE_URL ?? DEV_DATABASE_URL };
}

const realtimeEnvObject = z.object({
  ...databaseShape,
  PORT: portSchema.default("4000"),
});

/** apps/realtime — WebSocket server (Fly.io). */
export const realtimeEnvSchema = realtimeEnvObject
  .superRefine(requireDatabaseUrlInProduction)
  .transform(applyDevDatabaseDefault);

export type RealtimeEnv = z.infer<typeof realtimeEnvSchema>;

const cronEnvObject = z.object({
  ...databaseShape,
  LOG_LEVEL: logLevelSchema.default("info"),
});

/** apps/cron — weekly snapshot worker (Fly.io). */
export const cronEnvSchema = cronEnvObject
  .superRefine(requireDatabaseUrlInProduction)
  .transform(applyDevDatabaseDefault);

export type CronEnv = z.infer<typeof cronEnvSchema>;

/**
 * apps/web — Next.js app (Vercel).
 *
 * `NEXT_PUBLIC_*` values are inlined into the client bundle at build time, so
 * callers must pass them as literal `process.env.NEXT_PUBLIC_X` references
 * (see apps/web/lib/env.ts).
 */
const webEnvObject = z.object({
  ...databaseShape,
  VERCEL_URL: z.string().optional(),
  NEXT_PUBLIC_REALTIME_URL: z
    .string()
    .url("must be a URL (e.g. ws://localhost:4000)")
    .optional(),
  // Read by Auth.js (next-auth v5) internally, validated here at boot.
  AUTH_SECRET: z.string().min(1).optional(),
  AUTH_URL: z
    .string()
    .url("must be a URL (e.g. http://localhost:3000)")
    .optional(),
  // OAuth client credentials for the Auth.js providers (registered in
  // #21/#22, wired in apps/web/auth-providers.ts). Optional at boot: they are
  // captured when each provider is constructed, so the build and unrelated
  // pages never depend on them. A missing pair just means that provider's
  // sign-in fails (Auth.js raises a clear error) until the credentials are set
  // in the deployment env.
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  DISCORD_CLIENT_ID: z.string().min(1).optional(),
  DISCORD_CLIENT_SECRET: z.string().min(1).optional(),
});

export const webEnvSchema = webEnvObject
  .superRefine((env, ctx) => {
    if (
      env.NODE_ENV === "production" &&
      env.NEXT_PUBLIC_REALTIME_URL === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["NEXT_PUBLIC_REALTIME_URL"],
        message:
          "required in production — set it in the Vercel project env (see docs/env-vars.md)",
      });
    }
    if (env.NODE_ENV === "production" && env.AUTH_SECRET === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["AUTH_SECRET"],
        message:
          "required in production — set it in the Vercel project env (see docs/env-vars.md)",
      });
    }
    if (env.NODE_ENV === "production" && env.DATABASE_URL === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["DATABASE_URL"],
        message:
          "required in production — set it in the Vercel project env (see docs/env-vars.md)",
      });
    }
  })
  .transform(applyDevDatabaseDefault)
  .transform((env) => ({
    ...env,
    NEXT_PUBLIC_REALTIME_URL:
      env.NEXT_PUBLIC_REALTIME_URL ?? "ws://localhost:4000",
  }));

export type WebEnv = z.infer<typeof webEnvSchema>;

/**
 * Variable names each app reads, excluding NODE_ENV (set by the
 * platform/tooling, never written into a .env file by hand). The integration
 * suite uses these to keep `.env.example` files in sync with the schemas.
 */
function envKeys(object: z.AnyZodObject): string[] {
  return Object.keys(object.shape).filter((key) => key !== "NODE_ENV");
}

export const webEnvKeys = envKeys(webEnvObject);
export const realtimeEnvKeys = envKeys(realtimeEnvObject);
export const cronEnvKeys = envKeys(cronEnvObject);

export type EnvSource = Record<string, string | undefined>;

/**
 * Parse an environment against a schema, throwing a single aggregated error
 * that names every missing/malformed variable. Call once at app boot.
 *
 * Empty-string values are treated as unset: dotenv-style files represent
 * "no value" as `VAR=`, which must behave like an absent variable for
 * optionals and defaults.
 */
export function parseEnv<Schema extends z.ZodTypeAny>(
  schema: Schema,
  env: EnvSource = process.env,
): z.infer<Schema> {
  const present = Object.fromEntries(
    Object.entries(env).filter(
      ([, value]) => value !== undefined && value !== "",
    ),
  );
  const result = schema.safeParse(present);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(env)"}: ${issue.message}`)
      .join("\n");
    throw new Error(
      `Invalid environment variables:\n${issues}\n` +
        "See the app's .env.example and docs/env-vars.md for expected values.",
    );
  }
  return result.data as z.infer<Schema>;
}
