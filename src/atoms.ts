import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { MovieStatus } from "@/types";

export const moviesAtom = atomWithStorage<MovieStatus[]>("lb_movies", []);
export const isCheckingHistoryAtom = atom(false);
export const historyProgressAtom = atom({ checked: 0, total: 0 });
export const newMoviesSelectionAtom = atomWithStorage<Record<string, boolean>>(
  "lb_new_selection",
  {}
);
export const existingMoviesSelectionAtom = atomWithStorage<
  Record<string, boolean>
>("lb_existing_selection", {});
