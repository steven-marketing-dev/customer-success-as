import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { Repository } from "@/lib/db/repository";
import { requireAuth } from "@/lib/auth";

export async function PATCH(req: NextRequest) {
  const session = requireAuth(req);
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await req.json() as {
    calendly_url?: string | null;
    display_name?: string | null;
  };

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
  const user = repo.updateUserProfile(session.userId, {
    calendly_url: body.calendly_url === "" ? null : body.calendly_url,
    display_name: body.display_name,
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
    },
  });
}
