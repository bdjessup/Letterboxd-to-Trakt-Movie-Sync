import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReadPacing } from "./read-pacing";

function budgetNamespace() {
  const client = {
    reserve: vi.fn(async () => ({ at: Date.now(), cooldownUntil: 0 })),
    cooldown: vi.fn(async () => 0),
    pause: vi.fn(async (_until: number) => {}),
  };
  return { client, namespace: { getByName: vi.fn((_name: string) => client) } };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-03T12:00:00Z"));
  vi.spyOn(crypto.subtle, "digest").mockResolvedValue(new Uint8Array(32).buffer);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("createReadPacing", () => {
  it("waits for the reserved slot before allowing an upstream read", async () => {
    const { client, namespace } = budgetNamespace();
    const start = Date.now();
    client.reserve.mockResolvedValue({ at: start + 2_000, cooldownUntil: 0 });
    const pacing = createReadPacing(namespace, "account-a");
    let allowed = false;
    const pending = pacing.before().then((waited) => {
      allowed = true;
      return waited;
    });

    await vi.advanceTimersByTimeAsync(1_999);
    expect(allowed).toBe(false);
    expect(client.cooldown).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toBe(2_000);
    expect(client.cooldown).toHaveBeenCalledOnce();
  });

  it("checks for a shared pause published after the slot was reserved", async () => {
    const { client, namespace } = budgetNamespace();
    const start = Date.now();
    client.reserve.mockResolvedValue({ at: start + 2_000, cooldownUntil: 0 });
    const result = createReadPacing(namespace, "account-a")
      .before()
      .catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(1_000);
    client.cooldown.mockResolvedValue(start + 10_000);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(await result).toMatchObject({ code: "rate_limited", retryAfter: 8 });
  });

  it("hands an active shared cooldown back to the browser without sleeping", async () => {
    const { client, namespace } = budgetNamespace();
    const start = Date.now();
    client.reserve.mockResolvedValue({ at: start + 60_000, cooldownUntil: start + 60_000 });

    await expect(createReadPacing(namespace, "account-a").before()).rejects.toMatchObject({
      code: "rate_limited",
      retryAfter: 60,
    });
    expect(Date.now()).toBe(start);
    expect(client.cooldown).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses the same hashed name for an account and separates different accounts", async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    const { namespace } = budgetNamespace();
    const firstIdentity = "client-id|https://api.trakt.tv|private-account-a";
    const otherIdentity = "client-id|https://api.trakt.tv|private-account-b";

    await createReadPacing(namespace, firstIdentity).before();
    await createReadPacing(namespace, firstIdentity).before();
    await createReadPacing(namespace, otherIdentity).before();

    const names = namespace.getByName.mock.calls.map(([name]) => name);
    expect(names[0]).toBe(names[1]);
    expect(names[0]).not.toBe(names[2]);
    for (const name of names) {
      expect(name).toMatch(/^[a-f0-9]{64}$/);
      expect(name).not.toContain("private-account");
      expect(name).not.toContain("client-id");
      expect(name).not.toContain("trakt.tv");
    }
  });

  it("publishes the longest local pause and blocks later reads immediately", async () => {
    const { client, namespace } = budgetNamespace();
    const start = Date.now();
    const pacing = createReadPacing(namespace, "account-a");
    await pacing.pause(30);
    await vi.advanceTimersByTimeAsync(5_000);
    await pacing.pause(1);

    expect(client.pause.mock.calls).toEqual([[start + 30_000], [start + 30_000]]);
    await expect(pacing.before()).rejects.toMatchObject({
      code: "rate_limited",
      retryAfter: 25,
    });
    expect(client.reserve).not.toHaveBeenCalled();
  });

  it("returns long queue delays to the browser instead of holding its request", async () => {
    const { client, namespace } = budgetNamespace();
    const start = Date.now();
    client.reserve.mockResolvedValue({ at: start + 10_001, cooldownUntil: 0 });

    await expect(createReadPacing(namespace, "account-a").before()).rejects.toMatchObject({
      code: "rate_limited",
      retryAfter: 11,
    });
    expect(Date.now()).toBe(start);
    expect(client.cooldown).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
