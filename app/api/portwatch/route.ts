import { NextResponse } from "next/server";
import { getPortwatchSnapshot } from "@/lib/sources/portwatch";

// With cacheComponents enabled, data fetching (and route handlers) are dynamic
// by default; the 6h cache is handled inside the source module. No segment
// config needed.
export async function GET() {
  try {
    const snapshot = await getPortwatchSnapshot();
    return NextResponse.json(snapshot, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "PortWatch fetch failed" },
      { status: 502 },
    );
  }
}
