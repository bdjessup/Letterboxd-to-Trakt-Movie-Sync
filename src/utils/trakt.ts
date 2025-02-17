import axios from "axios";
import { LetterboxdEntry, TraktAuthConfig } from "@/types";

let accessToken: string | null = null;

interface TraktMovie {
  ids: {
    trakt: number;
    slug: string;
    imdb?: string;
    tmdb?: number;
  };
  title: string;
  year: number;
}

interface TraktSyncRequest {
  movies: Array<{
    ids: {
      trakt: number;
    };
    watched_at?: string;
    rated_at?: string;
    rating?: number;
  }>;
}

// Sleep function for rate limiting
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 3000; // 3 seconds between requests
const BATCH_INTERVAL = 10000; // 10 seconds between batches
let requestCount = 0;
const BATCH_SIZE = 10; // Reset count after 10 requests

export const initTraktClient = (config: TraktAuthConfig) => {
  accessToken = config.access_token || null;
};

const callTraktApi = async (
  endpoint: string,
  data: TraktSyncRequest | null = null,
  method: "GET" | "POST" = "POST",
  retryCount = 0
) => {
  if (!accessToken) {
    throw new Error("Trakt client not initialized");
  }

  // Ensure minimum time between requests
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
    await sleep(MIN_REQUEST_INTERVAL - timeSinceLastRequest);
  }

  // Add batch delay if we've made too many requests
  requestCount++;
  if (requestCount >= BATCH_SIZE) {
    console.log("Batch limit reached, waiting before continuing...");
    await sleep(BATCH_INTERVAL);
    requestCount = 0;
  }

  try {
    const config = {
      method,
      url:
        method === "GET"
          ? `/api/trakt/sync?endpoint=${encodeURIComponent(endpoint)}`
          : `/api/trakt/sync`,
      ...(method === "POST" && { data: { endpoint, data } }),
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    };

    const response = await axios(config);
    lastRequestTime = Date.now();
    return response.data;
  } catch (error) {
    if (
      axios.isAxiosError(error) &&
      error.response?.status === 429 &&
      retryCount < 3
    ) {
      // Exponential backoff: 4s, 8s, 16s
      const backoffTime = Math.pow(2, retryCount + 2) * 1000;
      console.log(`Rate limited. Retrying in ${backoffTime}ms...`);
      await sleep(backoffTime);
      return callTraktApi(endpoint, data, method, retryCount + 1);
    }
    throw error;
  }
};

export const convertLetterboxdRatingToTrakt = (rating: string): number => {
  if (!rating) return 0;
  const numRating = parseFloat(rating);
  return Math.round(numRating * 2);
};

export const searchMovie = async (
  name: string,
  year: string
): Promise<TraktMovie> => {
  try {
    const response = await callTraktApi(
      `/search/movie?query=${encodeURIComponent(name)}&year=${parseInt(year)}`,
      null,
      "GET"
    );

    if (!response || response.length === 0) {
      throw new Error(`Movie not found: ${name} (${year})`);
    }

    return response[0].movie;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(
        `Failed to search for movie: ${
          error.response?.data?.message || error.message
        }`
      );
    }
    throw new Error(`Failed to search for movie: ${name} (${year})`);
  }
};

export const checkMovieHistory = async (
  movie: TraktMovie
): Promise<boolean> => {
  try {
    const response = await callTraktApi(
      `/sync/history/movies/${movie.ids.trakt}`,
      null,
      "GET"
    );
    return response && response.length > 0;
  } catch (error) {
    console.error("Error checking movie history:", error);
    return false;
  }
};

export const syncMovieToTrakt = async (entry: LetterboxdEntry) => {
  const movie = await searchMovie(entry.Name, entry.Year);

  // Check if movie is already in history
  const isInHistory = await checkMovieHistory(movie);
  if (isInHistory) {
    return { movie, alreadyExists: true };
  }

  const watchedDate = entry.WatchedDate || entry.Date;
  const rating = convertLetterboxdRatingToTrakt(entry.Rating);

  try {
    // Add to history
    if (watchedDate) {
      await callTraktApi("/sync/history", {
        movies: [
          {
            ids: {
              trakt: movie.ids.trakt,
            },
            watched_at: new Date(watchedDate).toISOString(),
          },
        ],
      });
    }

    // Add rating if exists
    if (rating > 0) {
      await callTraktApi("/sync/ratings", {
        movies: [
          {
            rating,
            ids: {
              trakt: movie.ids.trakt,
            },
            rated_at: watchedDate
              ? new Date(watchedDate).toISOString()
              : undefined,
          },
        ],
      });
    }

    return { movie, alreadyExists: false };
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(
        `Failed to sync movie: ${
          error.response?.data?.message || error.message
        }`
      );
    }
    throw new Error(`Failed to sync movie: ${entry.Name} (${entry.Year})`);
  }
};
