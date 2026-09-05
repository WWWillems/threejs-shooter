import type { GameRoom } from "./GameRoom";

/**
 * Drive `room.tick` at a fixed rate. Uses an accumulator so the simulation
 * always advances in exact `1 / hz` steps regardless of timer jitter, and
 * catches up (bounded) after a stall.
 */
export function startTickLoop(room: GameRoom, hz: number): () => void {
  const stepMs = 1000 / hz;
  const dt = 1 / hz;
  const maxCatchUpSteps = 5;

  let last = Date.now();
  let accumulator = 0;

  const handle = setInterval(() => {
    const now = Date.now();
    accumulator += now - last;
    last = now;

    let steps = 0;
    while (accumulator >= stepMs && steps < maxCatchUpSteps) {
      room.tick(dt, now);
      accumulator -= stepMs;
      steps += 1;
    }
    // Drop time we could not catch up on rather than spiralling.
    if (steps === maxCatchUpSteps) accumulator = 0;
  }, stepMs);

  return () => clearInterval(handle);
}
