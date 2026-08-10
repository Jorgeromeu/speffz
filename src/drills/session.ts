// Shared right/asked scorekeeping for the discrete-question drills (s2l,
// l2s, piece; trace later). No DOM — the caller renders scoreText()
// wherever its own status bar lives. Deliberately just a running count for
// the current session: no persistence, no per-letter weighting (that
// tracking was cut — see project memory on keeping drills simple for now).
export interface Session {
  readonly right: number;
  readonly asked: number;
  record(correct: boolean): void;
  reset(): void;
  scoreText(): string;
}

export function createSession(): Session {
  let right = 0;
  let asked = 0;
  return {
    get right() {
      return right;
    },
    get asked() {
      return asked;
    },
    record(correct) {
      asked++;
      if (correct) right++;
    },
    reset() {
      right = 0;
      asked = 0;
    },
    scoreText() {
      return asked ? `${right}/${asked}` : "";
    },
  };
}
