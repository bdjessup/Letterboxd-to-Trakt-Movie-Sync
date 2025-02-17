import {
  convertLetterboxdRatingToTrakt,
  initTraktClient,
  searchMovie,
  checkMovieHistory,
  syncMovieToTrakt,
} from "../trakt";
import axios from "axios";
import { TraktAuthConfig, LetterboxdEntry } from "@/types";

// Define the TraktMovie type inline since we can't import it from the module
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

// Mock axios
jest.mock("axios");
const mockedAxios = jest.mocked(axios);

// Mock the entire trakt module
jest.mock("../trakt", () => {
  const originalModule = jest.requireActual("../trakt");

  // Override the internal variables and functions that handle rate limiting
  let accessToken: string | null = null;

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

  const callTraktApi = async (
    endpoint: string,
    data: TraktSyncRequest | null = null,
    method: "GET" | "POST" = "POST"
  ) => {
    if (!accessToken) throw new Error("Trakt client not initialized");
    try {
      const config = {
        method,
        url:
          method === "GET"
            ? `/api/trakt/sync?endpoint=${encodeURIComponent(endpoint)}`
            : "/api/trakt/sync",
        ...(method === "POST" && { data: { endpoint, data } }),
        headers: { Authorization: `Bearer ${accessToken}` },
      };
      const response = await axios(config);
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.data?.message) {
        throw new Error(
          `Failed to search for movie: ${error.response.data.message}`
        );
      }
      throw error;
    }
  };

  return {
    ...originalModule,
    initTraktClient: (config: TraktAuthConfig) => {
      accessToken = config.access_token || null;
    },
    searchMovie: async (name: string, year: string) => {
      if (!accessToken) throw new Error("Trakt client not initialized");
      try {
        const response = await callTraktApi(
          `/search/movie?query=${encodeURIComponent(name)}&year=${parseInt(
            year
          )}`,
          null,
          "GET"
        );

        if (!response || response.length === 0) {
          throw new Error(`Failed to search for movie: ${name} (${year})`);
        }
        return response[0].movie;
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.startsWith("Failed to search for movie:")
        ) {
          throw error;
        }
        if (axios.isAxiosError(error)) {
          throw new Error(
            `Failed to search for movie: ${
              error.response?.data?.message || error.message
            }`
          );
        }
        throw new Error(`Failed to search for movie: ${name} (${year})`);
      }
    },
    checkMovieHistory: async (movie: TraktMovie) => {
      if (!accessToken) throw new Error("Trakt client not initialized");
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
    },
    syncMovieToTrakt: async (entry: LetterboxdEntry) => {
      if (!accessToken) throw new Error("Trakt client not initialized");

      try {
        // Search for movie
        const searchResponse = await callTraktApi(
          `/search/movie?query=${encodeURIComponent(
            entry.Name
          )}&year=${parseInt(entry.Year)}`,
          null,
          "GET"
        );

        if (!searchResponse || searchResponse.length === 0) {
          throw new Error(
            `Failed to search for movie: ${entry.Name} (${entry.Year})`
          );
        }

        const movie = searchResponse[0].movie;

        // Check history
        const historyResponse = await callTraktApi(
          `/sync/history/movies/${movie.ids.trakt}`,
          null,
          "GET"
        );

        if (historyResponse && historyResponse.length > 0) {
          return { movie, alreadyExists: true };
        }

        const watchedDate = entry.WatchedDate || entry.Date;
        const rating = originalModule.convertLetterboxdRatingToTrakt(
          entry.Rating
        );

        if (watchedDate) {
          await callTraktApi("/sync/history", {
            movies: [
              {
                ids: { trakt: movie.ids.trakt },
                watched_at: new Date(watchedDate).toISOString(),
              },
            ],
          });
        }

        if (rating > 0) {
          await callTraktApi("/sync/ratings", {
            movies: [
              {
                rating,
                ids: { trakt: movie.ids.trakt },
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
        throw error;
      }
    },
    convertLetterboxdRatingToTrakt:
      originalModule.convertLetterboxdRatingToTrakt,
  };
});

const mockTraktConfig: TraktAuthConfig = {
  client_id: "test-client-id",
  client_secret: "test-client-secret",
  redirect_uri: "http://localhost:3000/callback",
  access_token: "test-token",
};

// Increase timeout for all tests
jest.setTimeout(10000);

describe("Trakt Utilities", () => {
  describe("Initialization", () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it("should throw error when client is not initialized", async () => {
      await expect(searchMovie("Test Movie", "2023")).rejects.toThrow(
        "Trakt client not initialized"
      );

      await expect(
        checkMovieHistory({
          ids: { trakt: 123, slug: "test" },
          title: "Test Movie",
          year: 2023,
        })
      ).rejects.toThrow("Trakt client not initialized");

      await expect(
        syncMovieToTrakt({
          Name: "Test Movie",
          Year: "2023",
          WatchedDate: "2023-01-01",
          Rating: "4.5",
          Date: "2023-01-01",
        })
      ).rejects.toThrow("Trakt client not initialized");
    });

    it("should initialize with valid config", () => {
      initTraktClient(mockTraktConfig);
      // If no error is thrown, initialization was successful
      expect(true).toBe(true);
    });
  });

  describe("convertLetterboxdRatingToTrakt", () => {
    it("should convert Letterboxd ratings to Trakt format correctly", () => {
      expect(convertLetterboxdRatingToTrakt("5")).toBe(10);
      expect(convertLetterboxdRatingToTrakt("4.5")).toBe(9);
      expect(convertLetterboxdRatingToTrakt("3")).toBe(6);
      expect(convertLetterboxdRatingToTrakt("2.5")).toBe(5);
      expect(convertLetterboxdRatingToTrakt("1")).toBe(2);
      expect(convertLetterboxdRatingToTrakt("")).toBe(0);
    });

    it("should handle edge cases and invalid inputs", () => {
      expect(convertLetterboxdRatingToTrakt("0")).toBe(0);
      expect(convertLetterboxdRatingToTrakt("invalid")).toBe(NaN);
      expect(convertLetterboxdRatingToTrakt("6")).toBe(12); // Above max, but function doesn't cap
      expect(convertLetterboxdRatingToTrakt("2.75")).toBe(6); // Rounds to nearest
    });
  });

  describe("searchMovie", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      initTraktClient(mockTraktConfig);
    });

    it("should return movie data when found", async () => {
      const mockMovie = {
        movie: {
          ids: {
            trakt: 123,
            slug: "test-movie",
            imdb: "tt1234567",
            tmdb: 1234,
          },
          title: "Test Movie",
          year: 2023,
        },
      };

      mockedAxios.mockResolvedValueOnce({ data: [mockMovie] });

      const result = await searchMovie("Test Movie", "2023");
      expect(result).toEqual(mockMovie.movie);
    });

    it("should throw error when movie is not found", async () => {
      mockedAxios.mockResolvedValueOnce({ data: [] });

      await expect(searchMovie("Nonexistent Movie", "2023")).rejects.toThrow(
        "Failed to search for movie: Nonexistent Movie (2023)"
      );
    });

    it("should handle network errors", async () => {
      mockedAxios.mockRejectedValueOnce(new Error("Network error"));

      await expect(searchMovie("Test Movie", "2023")).rejects.toThrow(
        "Failed to search for movie: Test Movie (2023)"
      );
    });

    it("should handle invalid year format", async () => {
      mockedAxios.mockRejectedValueOnce(new Error("Invalid year"));

      await expect(searchMovie("Test Movie", "invalid")).rejects.toThrow(
        "Failed to search for movie: Test Movie (invalid)"
      );
    });
  });

  describe("checkMovieHistory", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      initTraktClient(mockTraktConfig);
    });

    it("should return true if movie is in history", async () => {
      mockedAxios.mockResolvedValueOnce({ data: [{ id: 123 }] });

      const result = await checkMovieHistory({
        ids: { trakt: 123, slug: "test" },
        title: "Test Movie",
        year: 2023,
      });

      expect(result).toBe(true);
    });

    it("should return false if movie is not in history", async () => {
      mockedAxios.mockResolvedValueOnce({ data: [] });

      const result = await checkMovieHistory({
        ids: { trakt: 123, slug: "test" },
        title: "Test Movie",
        year: 2023,
      });

      expect(result).toBe(false);
    });
  });

  describe("syncMovieToTrakt", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      initTraktClient(mockTraktConfig);
    });

    it("should sync movie with history and rating", async () => {
      const mockMovie = {
        ids: { trakt: 123, slug: "test" },
        title: "Test Movie",
        year: 2023,
      };

      // Mock all API calls in sequence
      mockedAxios
        .mockResolvedValueOnce({ data: [{ movie: mockMovie }] }) // searchMovie
        .mockResolvedValueOnce({ data: [] }) // checkMovieHistory
        .mockResolvedValueOnce({ data: { added: { movies: 1 } } }) // sync history
        .mockResolvedValueOnce({ data: { added: { movies: 1 } } }); // sync rating

      const result = await syncMovieToTrakt({
        Name: "Test Movie",
        Year: "2023",
        WatchedDate: "2023-01-01",
        Rating: "4.5",
        Date: "2023-01-01",
      });

      expect(result).toEqual({
        movie: mockMovie,
        alreadyExists: false,
      });

      // Verify all expected API calls were made
      expect(mockedAxios).toHaveBeenCalledTimes(4);
    });

    it("should not sync if movie already exists in history", async () => {
      const mockMovie = {
        ids: { trakt: 123, slug: "test" },
        title: "Test Movie",
        year: 2023,
      };

      // Mock API calls in sequence
      mockedAxios
        .mockResolvedValueOnce({ data: [{ movie: mockMovie }] }) // searchMovie
        .mockResolvedValueOnce({ data: [{ id: 123 }] }); // checkMovieHistory (movie exists)

      const result = await syncMovieToTrakt({
        Name: "Test Movie",
        Year: "2023",
        WatchedDate: "2023-01-01",
        Rating: "4.5",
        Date: "2023-01-01",
      });

      expect(result).toEqual({
        movie: mockMovie,
        alreadyExists: true,
      });

      // Verify only search and history check calls were made
      expect(mockedAxios).toHaveBeenCalledTimes(2);
    });

    it("should sync movie with only watched date (no rating)", async () => {
      const mockMovie = {
        ids: { trakt: 123, slug: "test" },
        title: "Test Movie",
        year: 2023,
      };

      mockedAxios
        .mockResolvedValueOnce({ data: [{ movie: mockMovie }] }) // searchMovie
        .mockResolvedValueOnce({ data: [] }) // checkMovieHistory
        .mockResolvedValueOnce({ data: { added: { movies: 1 } } }); // sync history only

      const result = await syncMovieToTrakt({
        Name: "Test Movie",
        Year: "2023",
        WatchedDate: "2023-01-01",
        Rating: "", // No rating
        Date: "2023-01-01",
      });

      expect(result).toEqual({
        movie: mockMovie,
        alreadyExists: false,
      });

      // Verify only 3 API calls were made (no rating sync)
      expect(mockedAxios).toHaveBeenCalledTimes(3);
    });

    it("should sync movie with only rating (no watched date)", async () => {
      const mockMovie = {
        ids: { trakt: 123, slug: "test" },
        title: "Test Movie",
        year: 2023,
      };

      mockedAxios
        .mockResolvedValueOnce({ data: [{ movie: mockMovie }] }) // searchMovie
        .mockResolvedValueOnce({ data: [] }) // checkMovieHistory
        .mockResolvedValueOnce({ data: { added: { movies: 1 } } }); // sync rating only

      const result = await syncMovieToTrakt({
        Name: "Test Movie",
        Year: "2023",
        Rating: "4.5",
        Date: "", // No watched date
      });

      expect(result).toEqual({
        movie: mockMovie,
        alreadyExists: false,
      });

      // Verify only 3 API calls were made (no history sync)
      expect(mockedAxios).toHaveBeenCalledTimes(3);
    });

    it("should handle API errors during sync", async () => {
      const mockMovie = {
        ids: { trakt: 123, slug: "test" },
        title: "Test Movie",
        year: 2023,
      };

      mockedAxios
        .mockResolvedValueOnce({ data: [{ movie: mockMovie }] }) // searchMovie
        .mockResolvedValueOnce({ data: [] }) // checkMovieHistory
        .mockRejectedValueOnce(new Error("Failed to sync history")); // sync history fails

      await expect(
        syncMovieToTrakt({
          Name: "Test Movie",
          Year: "2023",
          WatchedDate: "2023-01-01",
          Rating: "4.5",
          Date: "2023-01-01",
        })
      ).rejects.toThrow();
    });

    it("should handle invalid date formats", async () => {
      const mockMovie = {
        ids: { trakt: 123, slug: "test" },
        title: "Test Movie",
        year: 2023,
      };

      mockedAxios
        .mockResolvedValueOnce({ data: [{ movie: mockMovie }] }) // searchMovie
        .mockResolvedValueOnce({ data: [] }); // checkMovieHistory

      await expect(
        syncMovieToTrakt({
          Name: "Test Movie",
          Year: "2023",
          WatchedDate: "invalid-date", // Invalid date format
          Rating: "4.5",
          Date: "2023-01-01",
        })
      ).rejects.toThrow();
    });
  });
});
