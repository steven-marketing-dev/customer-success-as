import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { Repository } from "@/lib/db/repository";
import { requireAuth } from "@/lib/auth";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = requireAuth(req);
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;
  const { rating, feedback } = await req.json();

  if (![1, 2, 3].includes(rating)) {
    return NextResponse.json({ error: "Rating must be 1, 2, or 3" }, { status: 400 });
  }

  const repo = new Repository(getDb());
  repo.rateMessage({
    message_id: parseInt(id, 10),
    user_id: session.userId,
    rating,
    feedback: feedback || null,
  });

  return NextResponse.json({ ok: true });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = requireAuth(req);
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;
  const repo = new Repository(getDb());
  const rating = repo.getMessageRating(parseInt(id, 10), session.userId);

  return NextResponse.json(rating ?? { rating: null, feedback: null });
}
