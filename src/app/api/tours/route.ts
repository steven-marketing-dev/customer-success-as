import { NextRequest, NextResponse } from "next/server";
import { Repository } from "@/lib/db/repository";
import { requireAuth } from "@/lib/auth";

/** GET: list completed tour keys for the current user */
export async function GET(req: NextRequest) {
  const session = requireAuth(req);
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const repo = new Repository();
  const completed = repo.getCompletedTours(session.userId);
  return NextResponse.json({ completed });
}

/** POST: mark a tour as completed */
export async function POST(req: NextRequest) {
  const session = requireAuth(req);
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { tourKey } = await req.json() as { tourKey: string };
  if (!tourKey?.trim()) {
    return NextResponse.json({ error: "tourKey is required" }, { status: 400 });
  }

  const repo = new Repository();
  repo.completeTour(session.userId, tourKey.trim());
  return NextResponse.json({ ok: true });
}

/** DELETE: reset a tour so it shows again */
export async function DELETE(req: NextRequest) {
  const session = requireAuth(req);
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { tourKey } = await req.json() as { tourKey: string };
  if (!tourKey?.trim()) {
    return NextResponse.json({ error: "tourKey is required" }, { status: 400 });
  }

  const repo = new Repository();
  repo.resetTour(session.userId, tourKey.trim());
  return NextResponse.json({ ok: true });
}
