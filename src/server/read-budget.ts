import { DurableObject } from "cloudflare:workers";

const READ_INTERVAL_MS = 667;

type BudgetState = {
  next_at: number;
  cooldown_until: number;
};

/** One timing budget per Trakt account, shared by its tabs and Worker requests. */
export class ReadBudget extends DurableObject<unknown> {
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS read_budget (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        next_at INTEGER NOT NULL,
        cooldown_until INTEGER NOT NULL
      );
      INSERT OR IGNORE INTO read_budget (id, next_at, cooldown_until) VALUES (1, 0, 0);
    `);
  }

  reserve(): { at: number; cooldownUntil: number } {
    const now = Date.now();
    const state = this.ctx.storage.sql
      .exec<BudgetState>("SELECT next_at, cooldown_until FROM read_budget WHERE id = 1")
      .one();
    if (state.cooldown_until > now) {
      return { at: state.cooldown_until, cooldownUntil: state.cooldown_until };
    }
    const at = Math.max(now, state.next_at);
    this.ctx.storage.sql.exec(
      "UPDATE read_budget SET next_at = ? WHERE id = 1",
      at + READ_INTERVAL_MS,
    );
    return { at, cooldownUntil: state.cooldown_until };
  }

  cooldown(): number {
    return this.ctx.storage.sql
      .exec<Pick<BudgetState, "cooldown_until">>(
        "SELECT cooldown_until FROM read_budget WHERE id = 1",
      )
      .one().cooldown_until;
  }

  pause(until: number): void {
    if (!Number.isFinite(until) || until < 0) throw new RangeError("Invalid cooldown timestamp.");
    const timestamp = Math.ceil(until);
    this.ctx.storage.sql.exec(
      "UPDATE read_budget SET cooldown_until = max(cooldown_until, ?), next_at = max(next_at, ?) WHERE id = 1",
      timestamp,
      timestamp,
    );
  }
}
