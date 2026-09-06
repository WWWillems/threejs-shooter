import type { Team, TeamCounts, TeamScores } from "./teams";

/**
 * Match pacing. One round is one match: the room loops
 *
 *   warmup -> countdown -> active -> round-end -> countdown -> ...
 *
 * and falls back to warmup whenever a team has nobody on it. The state
 * machine is a pure reducer over the server clock, the team head-count and
 * the team kill totals; `GameRoom` performs the side effects (world reset,
 * broadcasts, intent gating) for each transition it reports.
 */
export type MatchPhase = "warmup" | "countdown" | "active" | "round-end";

export type RoundWinner = Team | "draw";

export interface MatchRules {
  /** Team kills that end the round immediately. */
  killLimit: number;
  /** Length of the active round, ms. */
  roundMs: number;
  /** How long the results screen stays up, ms. */
  roundEndMs: number;
  /** Frozen-at-spawn countdown before the round starts, ms. */
  countdownMs: number;
}

export const DEFAULT_MATCH_RULES: MatchRules = {
  killLimit: 30,
  roundMs: 8 * 60_000,
  roundEndMs: 8_000,
  countdownMs: 5_000,
};

export interface RoundResult {
  winner: RoundWinner;
  /** Team kills when the round ended. */
  teamScores: TeamScores;
}

export interface MatchState {
  phase: MatchPhase;
  /** Server clock at which the current phase ends; `null` while in warmup. */
  phaseEndsAt: number | null;
  /** Set during `round-end`, `null` in every other phase. */
  result: RoundResult | null;
}

export interface MatchInput {
  /** Server clock, ms. */
  now: number;
  teamCounts: TeamCounts;
  teamScores: TeamScores;
}

export interface MatchTransition {
  from: MatchPhase;
  to: MatchPhase;
  /** The world (scores, players, crates, pickups, grenades) starts over. */
  reset: boolean;
}

export interface MatchStep {
  state: MatchState;
  /** `null` when the phase did not change this step. */
  transition: MatchTransition | null;
}

export const initialMatchState = (): MatchState => ({
  phase: "warmup",
  phaseEndsAt: null,
  result: null,
});

/** Both teams have at least one player: a round can be played. */
export const canPlayRound = (counts: TeamCounts): boolean =>
  counts.blue > 0 && counts.red > 0;

/** The team with more kills, or a draw. */
export function roundWinner(scores: TeamScores): RoundWinner {
  if (scores.blue === scores.red) return "draw";
  return scores.blue > scores.red ? "blue" : "red";
}

/** Players may move around (everything but the countdown freeze). */
export const movementAllowed = (phase: MatchPhase): boolean =>
  phase !== "countdown";

/** Shooting, grenades, pickups and damage happen. */
export const combatAllowed = (phase: MatchPhase): boolean =>
  phase === "warmup" || phase === "active";

/** Advance the match by one step. At most one transition per call. */
export function stepMatch(
  state: MatchState,
  input: MatchInput,
  rules: MatchRules = DEFAULT_MATCH_RULES
): MatchStep {
  const { now, teamCounts, teamScores } = input;
  const playable = canPlayRound(teamCounts);
  const expired = state.phaseEndsAt !== null && now >= state.phaseEndsAt;

  const go = (to: MatchPhase, phaseEndsAt: number | null, reset: boolean, result: RoundResult | null = null): MatchStep => ({
    state: { phase: to, phaseEndsAt, result },
    transition: { from: state.phase, to, reset },
  });
  const stay: MatchStep = { state, transition: null };

  switch (state.phase) {
    case "warmup":
      return playable ? go("countdown", now + rules.countdownMs, true) : stay;
    case "countdown":
      if (!playable) return go("warmup", null, false);
      return expired ? go("active", now + rules.roundMs, false) : stay;
    case "active": {
      const limitReached = Math.max(teamScores.blue, teamScores.red) >= rules.killLimit;
      if (!limitReached && !expired) return stay;
      return go("round-end", now + rules.roundEndMs, false, {
        winner: roundWinner(teamScores),
        teamScores: { ...teamScores },
      });
    }
    case "round-end":
      if (!expired) return stay;
      return playable
        ? go("countdown", now + rules.countdownMs, true)
        : go("warmup", null, true);
    default: {
      const unhandled: never = state.phase;
      throw new Error(`Unhandled match phase: ${String(unhandled)}`);
    }
  }
}
