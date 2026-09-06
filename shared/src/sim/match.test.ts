import { describe, expect, it } from "vitest";
import {
  type MatchRules,
  type MatchState,
  combatAllowed,
  initialMatchState,
  movementAllowed,
  roundWinner,
  stepMatch,
} from "./match";
import type { TeamCounts, TeamScores } from "./teams";

const rules: MatchRules = { killLimit: 3, roundMs: 10_000, roundEndMs: 2_000, countdownMs: 1_000 };
const both: TeamCounts = { blue: 1, red: 1 };
const blueOnly: TeamCounts = { blue: 2, red: 0 };
const nobody: TeamCounts = { blue: 0, red: 0 };
const zero: TeamScores = { blue: 0, red: 0 };

const step = (state: MatchState, now: number, teamCounts = both, teamScores = zero) =>
  stepMatch(state, { now, teamCounts, teamScores }, rules);

/** Drive a fresh match into `active`, returning the state and the clock. */
function activeMatch(): { state: MatchState; now: number } {
  let now = 1_000;
  let { state } = step(initialMatchState(), now); // -> countdown
  now += rules.countdownMs;
  ({ state } = step(state, now)); // -> active
  expect(state.phase).toBe("active");
  return { state, now };
}

describe("stepMatch", () => {
  it("stays in warmup until both teams have a player", () => {
    const start = initialMatchState();
    expect(step(start, 0, nobody).transition).toBeNull();
    expect(step(start, 0, blueOnly).transition).toBeNull();
    expect(step(start, 0, blueOnly).state.phaseEndsAt).toBeNull();
  });

  it("starts the countdown with a world reset once both teams are present", () => {
    const { state, transition } = step(initialMatchState(), 5_000);
    expect(transition).toEqual({ from: "warmup", to: "countdown", reset: true });
    expect(state).toEqual({ phase: "countdown", phaseEndsAt: 6_000, result: null });
  });

  it("goes active when the countdown expires", () => {
    const { state } = step(initialMatchState(), 5_000);
    expect(step(state, 5_999).transition).toBeNull();
    const started = step(state, 6_000);
    expect(started.transition).toEqual({ from: "countdown", to: "active", reset: false });
    expect(started.state.phaseEndsAt).toBe(6_000 + rules.roundMs);
  });

  it("drops back to warmup without a reset if a team empties during the countdown", () => {
    const { state } = step(initialMatchState(), 5_000);
    const back = step(state, 5_500, blueOnly);
    expect(back.transition).toEqual({ from: "countdown", to: "warmup", reset: false });
    expect(back.state.phaseEndsAt).toBeNull();
  });

  it("keeps an active round going when a team empties", () => {
    const { state, now } = activeMatch();
    expect(step(state, now + 1, blueOnly).transition).toBeNull();
  });

  it("ends the round when a team reaches the kill limit", () => {
    const { state, now } = activeMatch();
    expect(step(state, now + 1, both, { blue: 2, red: 2 }).transition).toBeNull();
    const ended = step(state, now + 1, both, { blue: 2, red: 3 });
    expect(ended.transition).toEqual({ from: "active", to: "round-end", reset: false });
    expect(ended.state.result).toEqual({ winner: "red", teamScores: { blue: 2, red: 3 } });
    expect(ended.state.phaseEndsAt).toBe(now + 1 + rules.roundEndMs);
  });

  it("ends the round on the clock, the leading team winning", () => {
    const { state, now } = activeMatch();
    const end = now + rules.roundMs;
    expect(step(state, end - 1, both, { blue: 1, red: 0 }).transition).toBeNull();
    const ended = step(state, end, both, { blue: 1, red: 0 });
    expect(ended.state.phase).toBe("round-end");
    expect(ended.state.result?.winner).toBe("blue");
  });

  it("calls a tied round on the clock a draw", () => {
    const { state, now } = activeMatch();
    const ended = step(state, now + rules.roundMs, both, { blue: 2, red: 2 });
    expect(ended.state.result?.winner).toBe("draw");
  });

  it("does not let team-kill penalties trigger the limit", () => {
    const { state, now } = activeMatch();
    expect(step(state, now + 1, both, { blue: -3, red: 0 }).transition).toBeNull();
  });

  it("resets into a new countdown after the results when both teams remain", () => {
    const { state, now } = activeMatch();
    const ended = step(state, now + 1, both, { blue: 3, red: 0 }).state;
    const endsAt = ended.phaseEndsAt ?? 0;
    expect(step(ended, endsAt - 1).transition).toBeNull();
    const next = step(ended, endsAt);
    expect(next.transition).toEqual({ from: "round-end", to: "countdown", reset: true });
    expect(next.state.result).toBeNull();
    expect(next.state.phaseEndsAt).toBe(endsAt + rules.countdownMs);
  });

  it("resets into warmup after the results when a team is gone", () => {
    const { state, now } = activeMatch();
    const ended = step(state, now + 1, both, { blue: 3, red: 0 }).state;
    const next = step(ended, ended.phaseEndsAt ?? 0, nobody);
    expect(next.transition).toEqual({ from: "round-end", to: "warmup", reset: true });
    expect(next.state).toEqual({ phase: "warmup", phaseEndsAt: null, result: null });
  });
});

describe("match helpers", () => {
  it("picks the winner or a draw", () => {
    expect(roundWinner({ blue: 4, red: 2 })).toBe("blue");
    expect(roundWinner({ blue: 1, red: 2 })).toBe("red");
    expect(roundWinner({ blue: 0, red: 0 })).toBe("draw");
  });

  it("allows movement everywhere but the countdown and combat only in play", () => {
    expect(movementAllowed("countdown")).toBe(false);
    expect(movementAllowed("round-end")).toBe(true);
    expect(combatAllowed("warmup")).toBe(true);
    expect(combatAllowed("active")).toBe(true);
    expect(combatAllowed("round-end")).toBe(false);
    expect(combatAllowed("countdown")).toBe(false);
  });
});
