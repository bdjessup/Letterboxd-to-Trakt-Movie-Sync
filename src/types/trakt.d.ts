declare module "trakt" {
  interface TraktOptions {
    client_id: string;
    client_secret: string;
    redirect_uri: string;
    access_token?: string;
  }

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

  interface TraktSearchResult {
    type: string;
    score: number;
    movie: TraktMovie;
  }

  interface TraktSyncResponse {
    added: {
      movies: number;
    };
    not_found: {
      movies: Array<{
        ids: {
          trakt: number;
        };
      }>;
    };
  }

  interface TraktAuthResponse {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    created_at: number;
    token_type: string;
    scope: string;
  }

  interface TraktSyncOptions {
    movies: Array<{
      ids: {
        trakt: number;
      };
      watched_at?: string;
      rated_at?: string;
      rating?: number;
    }>;
  }

  class Trakt {
    constructor(options: TraktOptions);

    search: {
      text(options: {
        query: string;
        type: "movie" | "show" | "episode" | "person";
        year?: number;
      }): Promise<TraktSearchResult[]>;
    };

    sync: {
      history: {
        add(data: TraktSyncOptions): Promise<TraktSyncResponse>;
      };
      ratings: {
        add(data: TraktSyncOptions): Promise<TraktSyncResponse>;
      };
    };

    exchange_code(code: string): Promise<TraktAuthResponse>;
    get_codes(): Promise<{ user_code: string; verification_url: string }>;
  }

  export default Trakt;
}
