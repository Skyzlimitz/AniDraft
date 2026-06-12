import { parseEnv, webEnvSchema } from "@anidraft/shared/env";

/**
 * Validated environment for the web app. Imported from the root layout so a
 * missing/malformed env fails `next build` (and `next dev`) immediately with
 * an error naming the variable. See docs/env-vars.md.
 *
 * `NEXT_PUBLIC_*` values are inlined into the client bundle at build time, so
 * they must be passed as literal `process.env.NEXT_PUBLIC_X` references —
 * dynamic lookups (including `parseEnv` reading all of `process.env`) are not
 * inlined and would be `undefined` in the browser.
 */
export const env = parseEnv(webEnvSchema, {
  NODE_ENV: process.env.NODE_ENV,
  VERCEL_URL: process.env.VERCEL_URL,
  NEXT_PUBLIC_REALTIME_URL: process.env.NEXT_PUBLIC_REALTIME_URL,
  AUTH_SECRET: process.env.AUTH_SECRET,
  AUTH_URL: process.env.AUTH_URL,
  DATABASE_URL: process.env.DATABASE_URL,
  DATABASE_AUTH_TOKEN: process.env.DATABASE_AUTH_TOKEN,
});
