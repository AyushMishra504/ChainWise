import { connection, NextResponse } from "next/server";
import { getNewsSnapshot } from "@/lib/sources/news";

// With cacheComponents enabled, route handlers are dynamic by default; the
// 30-minute cache lives inside the source module. No segment config needed.
export async function GET() {
  await connection();
  try {
    const snapshot = await getNewsSnapshot();
    return NextResponse.json(snapshot, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "News fetch failed" },
      { status: 502 },
    );
  }
}