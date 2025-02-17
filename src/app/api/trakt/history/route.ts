import { NextRequest, NextResponse } from "next/server";
import axios from "axios";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const name = searchParams.get("name");
  const year = searchParams.get("year");
  const token = request.headers.get("Authorization")?.split(" ")[1];

  if (!token) {
    return NextResponse.json({ error: "No token provided" }, { status: 401 });
  }

  if (!name || !year) {
    return NextResponse.json(
      { error: "Missing name or year parameter" },
      { status: 400 }
    );
  }

  try {
    // First search for the movie
    const searchResponse = await axios.get(
      `https://api.trakt.tv/search/movie?query=${encodeURIComponent(
        name
      )}&year=${year}`,
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "trakt-api-version": "2",
          "trakt-api-key": process.env.NEXT_PUBLIC_TRAKT_CLIENT_ID!,
        },
      }
    );

    if (!searchResponse.data || searchResponse.data.length === 0) {
      return NextResponse.json({ error: "Movie not found" }, { status: 404 });
    }

    const movie = searchResponse.data[0].movie;

    // Then check if it's in the user's history
    const historyResponse = await axios.get(
      `https://api.trakt.tv/sync/history/movies/${movie.ids.trakt}`,
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "trakt-api-version": "2",
          "trakt-api-key": process.env.NEXT_PUBLIC_TRAKT_CLIENT_ID!,
        },
      }
    );

    const alreadyExists =
      historyResponse.data && historyResponse.data.length > 0;
    const watchedAt = alreadyExists ? historyResponse.data[0].watched_at : null;

    return NextResponse.json({
      movie: { ...movie, watched_at: watchedAt },
      alreadyExists,
    });
  } catch (error) {
    console.error("Error checking movie history:", error);
    if (axios.isAxiosError(error)) {
      return NextResponse.json(
        { error: error.response?.data || "Failed to check movie history" },
        { status: error.response?.status || 500 }
      );
    }
    return NextResponse.json(
      { error: "Failed to check movie history" },
      { status: 500 }
    );
  }
}
