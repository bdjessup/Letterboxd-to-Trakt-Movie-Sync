import { atomWithStorage } from "jotai/utils";
import { MovieStatus } from "@/types";

export const moviesAtom = atomWithStorage<MovieStatus[]>("lb_movies", []);
export const isCheckingHistoryAtom = atomWithStorage<boolean>(
  "lb_checking",
  false
);
export const newMoviesSelectionAtom = atomWithStorage<Record<string, boolean>>(
  "lb_new_selection",
  {}
);
export const existingMoviesSelectionAtom = atomWithStorage<
  Record<string, boolean>
>("lb_existing_selection", {});
