import { SignJWT, jwtVerify } from "jose";
import { compare } from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/index";

const getSecret = () => {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET env var is required");
  return new TextEncoder().encode(secret);
};

export async function verifyPassword(
  plain: string,
  hash: string
): Promise<boolean> {
  return compare(plain, hash);
}

export async function createSession(
  userId: number,
  role: string
): Promise<string> {
  return new SignJWT({ userId, role })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getSecret());
}

export async function verifySession(
  token: string
): Promise<{ userId: number; role: string } | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return {
      userId: payload.userId as number,
      role: payload.role as string,
    };
  } catch {
    return null;
  }
}

export async function getSessionFromRequest(
  req: NextRequest
): Promise<{ userId: number; role: string } | null> {
  const token = req.cookies.get("session")?.value;
  if (!token) return null;
  return verifySession(token);
}

/** Read user identity from headers set by middleware.
 *  Returns null if unauthenticated, or if the user no longer exists: the session cookie is a
 *  7-day JWT that the middleware cannot check against the database, so a deleted user's cookie
 *  stays valid until it expires (DIS-412). The role comes from the users table, not the token. */
export function requireAuth(req: NextRequest): {
  userId: number;
  role: string;
} | null {
  const userId = req.headers.get("x-user-id");
  const role = req.headers.get("x-user-role");
  if (!userId || !role) return null;
  const id = parseInt(userId, 10);
  const user = getDb().prepare("SELECT role FROM users WHERE id = ?").get(id) as { role: string } | undefined;
  if (!user) return null;
  return { userId: id, role: user.role };
}

/** Guard for routes that change data: a 401 response unless the session belongs to an existing user. */
export function requireUser(req: NextRequest): NextResponse | null {
  return requireAuth(req) ? null : NextResponse.json({ error: "Not authenticated" }, { status: 401 });
}
