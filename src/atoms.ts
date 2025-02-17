import { atom } from "jotai";
import { MovieStatus } from "@/types";

export const moviesAtom = atom<MovieStatus[]>([]);
export const isCheckingHistoryAtom = atom<boolean>(false);
export const newMoviesSelectionAtom = atom<Record<string, boolean>>({});
export const existingMoviesSelectionAtom = atom<Record<string, boolean>>({});
