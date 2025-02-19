import { NextRequest, NextResponse } from "next/server";
import axios from "axios";

export async function GET(request: NextRequest) {
  const token = request.headers.get("Authorization")?.split(" ")[1];

  if (!token) {
    return NextResponse.json({ error: "No token provided" }, { status: 401 });
  }

  try {
    const response = await axios.get("https://api.trakt.tv/users/settings", {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "trakt-api-version": "2",
        "trakt-api-key": process.env.NEXT_PUBLIC_TRAKT_CLIENT_ID!,
      },
    });

    return NextResponse.json(response.data);
  } catch (error) {
    console.error("Error fetching user profile:", error);
    if (axios.isAxiosError(error)) {
      return NextResponse.json(
        { error: error.response?.data || "Failed to fetch user profile" },
        { status: error.response?.status || 500 }
      );
    }
    return NextResponse.json(
      { error: "Failed to fetch user profile" },
      { status: 500 }
    );
  }
}
