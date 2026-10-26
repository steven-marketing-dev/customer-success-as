import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { Repository } from "@/lib/db/repository";
import { requireAuth } from "@/lib/auth";
import { parseReportPrefs, reportPrefsOf } from "@/lib/user-report-prefs";

export async function PATCH(req: NextRequest) {
  const session = requireAuth(req);
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await req.json() as {
    calendly_url?: string | null;
    display_name?: string | null;
  } & Record<string, unknown>;

  const parsed = parseReportPrefs(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  // Validate Calendly URL if provided
  if (body.calendly_url !== undefined && body.calendly_url !== null && body.calendly_url !== "") {
    const pattern = /^https:\/\/calendly\.com\/[\w\-./]+$/;
    if (!pattern.test(body.calendly_url)) {
      return NextResponse.json(
        { error: "Invalid Calendly URL. Must be https://calendly.com/..." },
        { status: 400 }
      );
    }
  }

  const repo = new Repository(getDb());
  const current = repo.getUserById(session.userId);
  const email = parsed.prefs.email !== undefined ? parsed.prefs.email : current?.email;
  const anyReportOn = (["report_7d", "report_30d", "report_90d"] as const)
    .some((k) => parsed.prefs[k] ?? current?.[k] === 1);
  if (anyReportOn && !email) {
    return NextResponse.json({ error: "Add an email address to receive reports" }, { status: 400 });
  }

  const user = repo.updateUserProfile(session.userId, {
    calendly_url: body.calendly_url === "" ? null : body.calendly_url,
    display_name: body.display_name,
    ...parsed.prefs,
  });

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  return NextResponse.json({
    user: {
      id: user.id,
      username: user.username,
      display_name: user.display_name,
      calendly_url: user.calendly_url,
      role: user.role,
      ...reportPrefsOf(user),
    },
  });
}
