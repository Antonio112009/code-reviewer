/** A model counts as busy when its last tool call is at most this old. */
const ACTIVE_WINDOW_MS = 60_000;
/** Each extension adds a quarter of the base time, at least this much. */
const MIN_STEP_MS = 30_000;

/**
 * A task deadline that grows while the model keeps working: at the deadline, a model that called a tool
 * within the last minute gets another quarter of the base time, up to `maxExtensionMs` in total. The
 * reviews cut off by their time limit are the most thorough ones (14 tool calls against 4 elsewhere on
 * AACR-Bench); an idle or looping-without-tools model still times out on time.
 */
export class ActivityDeadline {
  private end: number;
  private extended = 0;
  private lastActivity = Number.NEGATIVE_INFINITY;

  constructor(
    readonly baseMs: number,
    readonly maxExtensionMs = 0,
    now = Date.now(),
  ) {
    this.end = now + baseMs;
  }

  /** The current deadline (epoch ms). */
  get at(): number {
    return this.end;
  }

  /** Time added so far. */
  get extendedMs(): number {
    return this.extended;
  }

  /** Records progress (a tool call). */
  touch(now = Date.now()): void {
    this.lastActivity = now;
  }

  /** At the deadline: extend it when the model was busy just now; false when the task should stop. */
  tryExtend(now = Date.now()): boolean {
    const left = this.maxExtensionMs - this.extended;
    if (left <= 0 || now - this.lastActivity > ACTIVE_WINDOW_MS) return false;
    const step = Math.min(left, Math.max(MIN_STEP_MS, Math.round(this.baseMs / 4)));
    this.extended += step;
    this.end = now + step;
    return true;
  }
}
