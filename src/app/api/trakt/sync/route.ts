import { NextResponse } from "next/server";
import axios from "axios";

export async function POST(request: Request) {
  const { endpoint, data } = await request.json();
  const token = request.headers.get("Authorization")?.split(" ")[1];

  if (!token) {
    return NextResponse.json({ error: "No token provided" }, { status: 401 });
  }

  try {
    const response = await axios.post(`https://api.trakt.tv${endpoint}`, data, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "trakt-api-version": "2",
        "trakt-api-key": process.env.NEXT_PUBLIC_TRAKT_CLIENT_ID!,
      },
    });

    return NextResponse.json(response.data);
  } catch (error) {
    if (axios.isAxiosError(error)) {
      return NextResponse.json(
        { error: error.response?.data || "Failed to sync" },
        { status: error.response?.status || 500 }
      );
    }
    return NextResponse.json({ error: "Failed to sync" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const endpoint = searchParams.get("endpoint");
  const token = request.headers.get("Authorization")?.split(" ")[1];

  if (!endpoint) {
    return NextResponse.json(
      { error: "No endpoint provided" },
      { status: 400 }
    );
  }

  if (!token) {
    return NextResponse.json({ error: "No token provided" }, { status: 401 });
  }

  try {
    const response = await axios.get(`https://api.trakt.tv${endpoint}`, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "trakt-api-version": "2",
        "trakt-api-key": process.env.NEXT_PUBLIC_TRAKT_CLIENT_ID!,
      },
    });

    return NextResponse.json(response.data);
  } catch (error) {
    if (axios.isAxiosError(error)) {
      return NextResponse.json(
        { error: error.response?.data || "Failed to fetch data" },
        { status: error.response?.status || 500 }
      );
    }
    return NextResponse.json(
      { error: "Failed to fetch data" },
      { status: 500 }
    );
  }
}
