import { NextResponse } from "next/server";
import { getPortwatchPortsSnapshot } from "@/lib/sources/portwatch-ports";

// With cacheComponents enabled, data fetching (and route handlers) are dynamic
// by default; the 6h cache is handled inside the source module. No segment
// config needed.
export async function GET() {
  try {
    const snapshot = await getPortwatchPortsSnapshot();
    return NextResponse.json(snapshot, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "PortWatch ports fetch failed" },
      { status: 502 },
    );
  }
}
