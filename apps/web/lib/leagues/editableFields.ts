import type { EditableField } from "./updateLeagueSettings";

/**
 * Client-safe single source of truth for the league settings a commissioner may
 * edit once the league is `finalized`: only the draft start time (the draft
 * hasn't started yet, everything else is locked).
 *
 * This lives in its own module — separate from `updateLeagueSettings.ts`, which
 * pulls in Drizzle/DB code and can't be imported into a client component — so the
 * server's {@link editableFieldsFor} (`updateLeagueSettings`) and the optimistic
 * in-page lock in the settings forms (`PrivateLeagueSettings` /
 * `PublicLobbySettings`, which narrow to this set after an in-page finalize) all
 * reference the same constant instead of re-declaring it. The type-only import
 * of {@link EditableField} is erased by the bundler, so no DB code reaches the
 * client. Keep this module free of runtime imports from server-only modules.
 */
export const FINALIZED_EDITABLE_FIELDS: readonly EditableField[] = [
  "draftStartsAt",
];
