import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { Repository } from "@/lib/db/repository";
import { requireAuth } from "@/lib/auth";
import { parseReportPrefs, reportPrefsOf } from "@/lib/user-report-prefs";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = requireAuth(req);
  if (!session || session.role !== "master") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const userId = parseInt(id, 10);

  if (userId === session.userId) {
    return NextResponse.json(
      { error: "Cannot delete your own account" },
      { status: 400 }
    );
  }

  const repo = new Repository(getDb());
  repo.deleteUser(userId);
  return NextResponse.json({ ok: true });
}

/** Master-only: set another user's report email and which widget usage reports they receive. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = requireAuth(req);
  if (!session || session.role !== "master") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const userId = parseInt(id, 10);
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const parsed = parseReportPrefs(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const repo = new Repository(getDb());
  const current = repo.getUserById(userId);
  if (!current) return NextResponse.json({ error: "User not found" }, { status: 404 });
  const email = parsed.prefs.email !== undefined ? parsed.prefs.email : current.email;
  const anyOn = (["report_7d", "report_30d", "report_90d"] as const)
    .some((k) => parsed.prefs[k] ?? current[k] === 1);
  if (anyOn && !email) {
    return NextResponse.json({ error: "Add an email address to receive reports" }, { status: 400 });
  }

  const user = repo.updateUserProfile(userId, parsed.prefs)!;
  return NextResponse.json({ id: user.id, ...reportPrefsOf(user) });
}
