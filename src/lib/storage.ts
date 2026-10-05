import { clear, createStore, del, get, set, type UseStore } from "idb-keyval";

/** Bump when stored shapes change incompatibly; older data is ignored. */
const VERSION = 2;

let store: UseStore | null | undefined;

function getStore(): UseStore | null {
  if (store === undefined) {
    try {
      store = typeof indexedDB === "undefined" ? null : createStore("letterboxd-to-trakt", "state");
    } catch {
      store = null;
    }
  }
  return store;
}

interface Envelope<T> {
  v: number;
  data: T;
}

/** Read a value saved in this browser. Returns undefined if missing, stale or unavailable. */
export async function load<T>(key: string): Promise<T | undefined> {
  const s = getStore();
  if (!s) return undefined;
  try {
    const value = await get<Envelope<T>>(key, s);
    return value?.v === VERSION ? value.data : undefined;
  } catch {
    return undefined;
  }
}

export async function save<T>(key: string, data: T): Promise<void> {
  const s = getStore();
  if (!s) return;
  try {
    await set(key, { v: VERSION, data } satisfies Envelope<T>, s);
  } catch {
    // Private mode or storage full: the app still works, it just won't resume after reload.
  }
}

export async function remove(key: string): Promise<void> {
  const s = getStore();
  if (!s) return;
  try {
    await del(key, s);
  } catch {}
}

export async function removeAll(): Promise<void> {
  const s = getStore();
  if (!s) return;
  try {
    await clear(s);
  } catch {}
}
