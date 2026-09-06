/**
 * Teams. Two fixed sides, blue and red; the server assigns each joiner to the
 * side with fewer players and never lets a player choose or switch.
 */
export type Team = "blue" | "red";

export const TEAMS: readonly Team[] = ["blue", "red"];

/** Players per team; the room holds `MAX_PLAYERS` in total. */
export const MAX_TEAM_SIZE = 5;
export const MAX_PLAYERS = MAX_TEAM_SIZE * TEAMS.length;

/** Running kill totals per team. */
export type TeamScores = Record<Team, number>;

export type TeamCounts = Record<Team, number>;

export const isTeam = (value: unknown): value is Team =>
  value === "blue" || value === "red";

export const otherTeam = (team: Team): Team => (team === "blue" ? "red" : "blue");

export const emptyTeamScores = (): TeamScores => ({ blue: 0, red: 0 });

/**
 * The team a new player joins: the one with fewer players, blue on a tie.
 * `null` when both teams are full.
 */
export function pickTeam(counts: TeamCounts): Team | null {
  const blueOpen = counts.blue < MAX_TEAM_SIZE;
  const redOpen = counts.red < MAX_TEAM_SIZE;
  if (!blueOpen && !redOpen) return null;
  if (!redOpen) return "blue";
  if (!blueOpen) return "red";
  return counts.red < counts.blue ? "red" : "blue";
}
