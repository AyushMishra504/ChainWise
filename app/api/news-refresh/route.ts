import { connection, NextResponse } from "next/server";
import { refreshNewsSnapshot } from "@/lib/sources/news";

export async function GET() {
  await connection();
  try {
    const snapshot = await refreshNewsSnapshot();
    return NextResponse.json({
      fetchedAt: snapshot.fetchedAt,
      items: snapshot.items.length,
      feeds: snapshot.feeds.map((feed) => ({ name: feed.name, ok: feed.ok, items: feed.items, error: feed.error })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "refresh failed" },
      { status: 502 },
    );
  }
}