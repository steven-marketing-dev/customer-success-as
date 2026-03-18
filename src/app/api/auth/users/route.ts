import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { Repository } from "@/lib/db/repository";
import { requireAuth } from "@/lib/auth";
import { hashSync } from "bcryptjs";

export async function GET(req: NextRequest) {
  const session = requireAuth(req);
  if (!session || session.role !== "master") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const repo = new Repository(getDb());
  const users = repo.getAllUsers();
  return NextResponse.json(
    users.map((u) => ({
      id: u.id,
      username: u.username,
      display_name: u.display_name,
      role: u.role,
      created_at: u.created_at,
    }))
  );
}

export async function POST(req: NextRequest) {
  const session = requireAuth(req);
  if (!session || session.role !== "master") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { username, password, display_name, role } = await req.json();
    if (!username || !password) {
      return NextResponse.json(
        { error: "Username and password required" },
        { status: 400 }
      );
    }

    const repo = new Repository(getDb());
    const hash = hashSync(password, 10);
    const user = repo.createUser({
      username,
      password_hash: hash,
      display_name: display_name || null,
      role: role === "master" ? "master" : "user",
    });

    return NextResponse.json({
      id: user.id,
      username: user.username,
      display_name: user.display_name,
      role: user.role,
    });
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.includes("UNIQUE constraint")) {
      return NextResponse.json(
        { error: "Username already exists" },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
