import { and, eq, isNull, sql } from "drizzle-orm";
import {
  leagueMembers,
  leagues,
  type Db,
  type LeagueStatus,
  type LeagueVisibility,
} from "@anidraft/db";
import type { UpdateLeagueSettingsInput } from "@anidraft/shared";

import { PUBLIC_PICK_TIMER_SECONDS } from "./createLeague";
import { FINALIZED_EDITABLE_FIELDS } from "./editableFields";

/**
 * Update-league-settings domain logic, kept free of any HTTP/Next concerns so
 * it can be driven by the `PATCH /api/leagues/[id]` route and exercised
 * directly in tests against an in-memory database.
 *
 * The whole update runs in one transaction: reading the league, counting its
 * active members (for the `maxPlayers` floor), and writing the new values all
 * see a consistent snapshot, so the floor check can't be raced by a player
 * joining mid-update.
 *
 * ## Editability rules (issue #33)
 *
 * | League status         | Editable fields                                   |
 * | --------------------- | ------------------------------------------------- |
 * | `setup`               | name, maxPlayers, pickTimerSeconds, draftStartsAt |
 * | `finalized`           | draftStartsAt only (the draft hasn't started yet) |
 * | drafting / in_season / completed | nothing — settings are frozen          |
 *
 * **Public ("lobby") leagues** layer a hard allowlist over those state rules:
 * only `maxPlayers` and `draftStartsAt` are ever editable (issue #34). The pick
 * timer is locked to {@link PUBLIC_PICK_TIMER_SECONDS} and the pool is fixed to
 * the AniList tag, so a payload touching `name` or `pickTimerSeconds` on a
 * public league is rejected as `public_field_locked` (→ 403) — a permanent
 * public-vs-private boundary, distinct from the transient `locked` (→ 409) a
 * field hits once the league's lifecycle state moves past `setup`/`finalized`.
 *
 * Only the commissioner may edit at all; any other caller gets `forbidden`.
 * `maxPlayers` may never drop below the current active-member count (you can't
 * shrink a league below the people already in it).
 */

/** A league's editable settings plus the context the settings UI renders. */
export interface LeagueSettingsView {
  id: string;
  name: string;
  status: LeagueStatus;
  visibility: LeagueVisibility;
  maxPlayers: number;
  pickTimerSeconds: number;
  draftStartsAt: Date | null;
  /** Active (non-kicked) member count — the floor for `maxPlayers`. */
  memberCount: number;
}

/**
 * The outcome of a settings update, as a discriminated union on `status` so the
 * route can map each case to a status code without parsing an error string.
 *
 * - `updated`       — the new settings were written; carries the fresh view.
 * - `not_found`     — no league with that id.
 * - `forbidden`     — the caller is not the league's commissioner.
 * - `locked`        — the league's lifecycle state forbids editing the supplied
 *                     fields (e.g. editing `name` after finalize, or any edit
 *                     once drafting). `editableFields` tells the caller what (if
 *                     anything) it *could* still change from this state.
 * - `public_field_locked` — a public ("lobby") league PATCH named a field
 *                     outside the public allowlist (`name`/`pickTimerSeconds`).
 *                     Unlike `locked`, this never clears with a state change;
 *                     `allowedFields` says what the lobby can edit *from its
 *                     current state* (e.g. only `draftStartsAt` once finalized),
 *                     so a client can surface it without overstating what's open.
 * - `invalid_max_players` — `maxPlayers` was below the current member count.
 */
export type UpdateLeagueSettingsResult =
  | { status: "updated"; league: LeagueSettingsView }
  | { status: "not_found" }
  | { status: "forbidden" }
  | {
      status: "locked";
      leagueStatus: LeagueStatus;
      editableFields: readonly EditableField[];
    }
  | {
      status: "public_field_locked";
      allowedFields: readonly EditableField[];
      disallowedFields: readonly EditableField[];
    }
  | { status: "invalid_max_players"; memberCount: number };

/** The settings fields a commissioner can ever change, by name. */
export type EditableField =
  | "name"
  | "maxPlayers"
  | "pickTimerSeconds"
  | "draftStartsAt";

/**
 * The settings a **public ("lobby")** league commissioner may ever edit (issue
 * #34): the player count and the draft start time, nothing else. Public lobbies
 * run on stripped, uniform settings — the pick timer is locked to
 * {@link PUBLIC_PICK_TIMER_SECONDS} and the pool is fixed to the AniList tag —
 * so the editor exposes (and the API accepts) only these two fields. This is
 * layered over the per-state rule in {@link editableFieldsFor}, so a public
 * league still freezes them once it leaves `setup`/`finalized`.
 */
export const PUBLIC_EDITABLE_FIELDS: readonly EditableField[] = [
  "maxPlayers",
  "draftStartsAt",
];

/**
 * Which fields are editable from a given league status. `setup` is fully open;
 * `finalized` allows only rescheduling the (not-yet-started) draft; every later
 * state freezes settings entirely.
 */
export function editableFieldsFor(
  status: LeagueStatus,
): readonly EditableField[] {
  switch (status) {
    case "setup":
      return ["name", "maxPlayers", "pickTimerSeconds", "draftStartsAt"];
    case "finalized":
      // Single source of truth, shared with the client-side optimistic lock.
      return FINALIZED_EDITABLE_FIELDS;
    case "drafting":
    case "in_season":
    case "completed":
      return [];
  }
}

/**
 * Editable fields for a whole league, layering visibility over the state rule.
 * **Public ("lobby")** leagues run on stripped lobby settings (see
 * `createLeague`): the pick timer and pool are fixed, so the commissioner can
 * only ever tune the player count and draft start time (issue #34). We
 * intersect the per-state set with {@link PUBLIC_EDITABLE_FIELDS}, so a public
 * league is editable in `setup` (maxPlayers + draftStartsAt) and `finalized`
 * (draftStartsAt only), and frozen once drafting — never exposing `name` or
 * `pickTimerSeconds`. Private leagues fall through to {@link editableFieldsFor}.
 */
export function editableFieldsForLeague(
  visibility: LeagueVisibility,
  status: LeagueStatus,
): readonly EditableField[] {
  const byState = editableFieldsFor(status);
  if (visibility === "public") {
    return byState.filter((field) => PUBLIC_EDITABLE_FIELDS.includes(field));
  }
  return byState;
}

/**
 * Apply `input` to league `leagueId` on behalf of `userId`.
 *
 * Order of checks (each short-circuits): league exists → caller is commissioner
 * → every supplied field is editable from the current state → `maxPlayers`
 * respects the member-count floor → write.
 */
export async function updateLeagueSettings(
  db: Db,
  leagueId: string,
  userId: string,
  input: UpdateLeagueSettingsInput,
): Promise<UpdateLeagueSettingsResult> {
  return db.transaction(async (tx) => {
    const [league] = await tx
      .select()
      .from(leagues)
      .where(eq(leagues.id, leagueId))
      .limit(1);
    if (!league) {
      return { status: "not_found" };
    }

    // Access control: only the commissioner may edit. A null commissionerId
    // (orphaned league) is never equal to a real user id, so this also denies
    // edits to an orphaned league until it's reassigned.
    if (league.commissionerId !== userId) {
      return { status: "forbidden" };
    }

    const requested = requestedFields(input);
    const editable = editableFieldsForLeague(league.visibility, league.status);

    // Public lobbies have a hard allowlist: only the player count and draft
    // start time are ever editable. A payload naming `name` or
    // `pickTimerSeconds` crosses the public-vs-private boundary, which no state
    // change can ever open, so answer `public_field_locked` (→ 403) rather than
    // the transient `locked` (→ 409) used for lifecycle freezes. Checked before
    // the state rule so the 403 reason is the precise one (the field is *never*
    // editable here), not a generic "locked from this state". `allowedFields`
    // reports the state-aware set (`editable`), so a finalized lobby's 403
    // advertises only `draftStartsAt`, not the now-locked `maxPlayers`.
    if (league.visibility === "public") {
      const disallowed = requested.filter(
        (field) => !PUBLIC_EDITABLE_FIELDS.includes(field),
      );
      if (disallowed.length > 0) {
        return {
          status: "public_field_locked",
          allowedFields: editable,
          disallowedFields: disallowed,
        };
      }
    }

    // Reject the request if it touches any field that isn't editable from this
    // state, rather than silently dropping the change — the caller asked for
    // something the league's lifecycle won't allow.
    const illegal = requested.filter((field) => !editable.includes(field));
    if (illegal.length > 0) {
      return {
        status: "locked",
        leagueStatus: league.status,
        editableFields: editable,
      };
    }

    // Count active members up front: the floor for `maxPlayers`, and part of the
    // view returned on success.
    const memberRows = await tx
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(leagueMembers)
      .where(
        and(
          eq(leagueMembers.leagueId, leagueId),
          isNull(leagueMembers.kickedAt),
        ),
      );
    const memberCount = memberRows[0]?.count ?? 0;

    if (input.maxPlayers !== undefined && input.maxPlayers < memberCount) {
      return { status: "invalid_max_players", memberCount };
    }

    // Build the patch from only the supplied keys. `draftStartsAt` is special:
    // an explicit `null` clears the schedule, so we distinguish "key present"
    // (including null) from "key omitted".
    const patch: Partial<typeof leagues.$inferInsert> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.maxPlayers !== undefined) patch.maxPlayers = input.maxPlayers;
    if (input.pickTimerSeconds !== undefined) {
      patch.pickTimerSeconds = input.pickTimerSeconds;
    }
    if ("draftStartsAt" in input) {
      patch.draftStartsAt = input.draftStartsAt ?? null;
    }

    // Belt-and-suspenders for the lobby invariant (issue #34): a public league's
    // pick timer is immutable at PUBLIC_PICK_TIMER_SECONDS. The allowlist above
    // already 403s any payload that names `pickTimerSeconds`, so this never
    // overrides a value the caller sent — it just guarantees the DB holds 90 on
    // every public write, healing any drift from an out-of-band change.
    if (league.visibility === "public") {
      patch.pickTimerSeconds = PUBLIC_PICK_TIMER_SECONDS;
    }

    const [updated] = await tx
      .update(leagues)
      .set(patch)
      .where(eq(leagues.id, leagueId))
      .returning();
    if (!updated) {
      // The row existed at the top of the transaction; a missing return here is
      // an unexpected write failure, not a "not found".
      throw new Error("Failed to update league settings");
    }

    return {
      status: "updated",
      league: {
        id: updated.id,
        name: updated.name,
        status: updated.status,
        visibility: updated.visibility,
        maxPlayers: updated.maxPlayers,
        pickTimerSeconds: updated.pickTimerSeconds,
        draftStartsAt: updated.draftStartsAt,
        memberCount,
      },
    };
  });
}

/** The {@link EditableField}s actually present in an update payload. */
function requestedFields(
  input: UpdateLeagueSettingsInput,
): readonly EditableField[] {
  const fields: EditableField[] = [];
  if (input.name !== undefined) fields.push("name");
  if (input.maxPlayers !== undefined) fields.push("maxPlayers");
  if (input.pickTimerSeconds !== undefined) fields.push("pickTimerSeconds");
  // `draftStartsAt: null` is a real change (clear the schedule), so test for key
  // presence, not for a truthy value.
  if ("draftStartsAt" in input) fields.push("draftStartsAt");
  return fields;
}
