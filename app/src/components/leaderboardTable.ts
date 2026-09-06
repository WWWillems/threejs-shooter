import type { LeaderboardEntry, Team } from "@threejs-shooter/shared";

/** Best score first, then kills, then fewest deaths. */
export const sortLeaderboard = (rows: LeaderboardEntry[]): LeaderboardEntry[] =>
  [...rows].sort((a, b) => b.score - a.score || b.kills - a.kills || a.deaths - b.deaths);

/**
 * Fill a `.leaderboard-table` body with one team's rows: rank, name, score,
 * kills, deaths. Shared by the Tab leaderboard and the round-end board.
 */
export function renderTeamTable(
  body: HTMLElement,
  rows: LeaderboardEntry[],
  team: Team,
  selfId: string | null
): void {
  body.innerHTML = "";
  const teamRows = sortLeaderboard(rows.filter((player) => player.team === team));

  if (teamRows.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.className = "leaderboard-empty";
    cell.colSpan = 5;
    cell.textContent = "No players";
    row.appendChild(cell);
    body.appendChild(row);
    return;
  }

  teamRows.forEach((player, index) => {
    const row = document.createElement("tr");
    const rank = index + 1;
    if (player.id === selfId) row.classList.add("highlight-player");
    if (rank <= 3) row.classList.add(`rank-${rank}`);

    const rankCell = document.createElement("td");
    rankCell.className = "leaderboard-rank-cell";
    rankCell.textContent = String(rank);
    row.appendChild(rankCell);

    for (const value of [player.name, player.score, player.kills, player.deaths]) {
      const cell = document.createElement("td");
      cell.textContent = String(value);
      if (typeof value === "number" && value < 0) cell.classList.add("leaderboard-negative");
      row.appendChild(cell);
    }

    body.appendChild(row);
  });
}

/** The `<table>` markup for one team, with an empty body to fill via `renderTeamTable`. */
export function teamTableMarkup(team: Team, label: string, bodyId: string): string {
  return `
    <table class="leaderboard-table team-${team}">
      <thead>
        <tr>
          <th>#</th>
          <th>${label}</th>
          <th>Score</th>
          <th>K</th>
          <th>D</th>
        </tr>
      </thead>
      <tbody id="${bodyId}"></tbody>
    </table>`;
}
