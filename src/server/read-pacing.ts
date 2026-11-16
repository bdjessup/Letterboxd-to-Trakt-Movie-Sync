import { TraktError } from "./trakt";

export interface ReadPacing {
  before(): Promise<number>;
  pause(seconds: number): Promise<void>;
}

type Budget = import("./read-budget").ReadBudget;
interface BudgetClient {
  reserve(): Promise<ReturnType<Budget["reserve"]>>;
  cooldown(): Promise<ReturnType<Budget["cooldown"]>>;
  pause(until: number): Promise<void>;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function throttled(until: number): TraktError {
  return new TraktError(
    429,
    "rate_limited",
    "Trakt needs a pause. Your progress is saved and will resume automatically.",
    Math.max(1, Math.ceil((until - Date.now()) / 1000)),
  );
}

/** One account shares timing across requests, tabs and Worker isolates. */
export function createReadPacing(
  namespace: { getByName(name: string): BudgetClient },
  identity: string,
): ReadPacing {
  let blockedUntil = 0;
  let stub: ReturnType<typeof namespace.getByName> | undefined;
  async function budget() {
    if (!stub) {
      const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity));
      const name = Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join(
        "",
      );
      stub = namespace.getByName(name);
    }
    return stub;
  }
  return {
    async before() {
      const started = Date.now();
      if (blockedUntil > started) throw throttled(blockedUntil);
      const shared = await budget();
      const slot = await shared.reserve();
      if (slot.cooldownUntil > Date.now()) throw throttled(slot.cooldownUntil);
      const wait = slot.at - Date.now();
      // Long waits belong in the browser, where progress and cancellation remain visible.
      if (wait > 10_000) throw throttled(slot.at);
      if (wait > 0) await sleep(wait);
      if (blockedUntil > Date.now()) throw throttled(blockedUntil);
      const until = await shared.cooldown();
      if (until > Date.now()) throw throttled(until);
      return Date.now() - started;
    },
    async pause(seconds) {
      blockedUntil = Math.max(blockedUntil, Date.now() + Math.max(1, seconds) * 1000);
      await (await budget()).pause(blockedUntil);
    },
  };
}
