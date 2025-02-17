export interface LetterboxdEntry {
  Date: string;
  Name: string;
  Year: string;
  Rating: string;
  WatchedDate?: string;
}

export interface MovieStatus {
  id: string;
  name: string;
  year: string;
  letterboxdRating: number | null;
  traktRating: number | null;
  watchedDate: string | null;
  traktWatchedDate: string | null;
  synced: boolean;
  syncError?: string;
  selected: boolean;
}

export interface TraktAuthConfig {
  client_id: string;
  client_secret: string;
  redirect_uri: string;
  access_token?: string;
}
