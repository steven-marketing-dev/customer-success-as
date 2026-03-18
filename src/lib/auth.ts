import { SignJWT, jwtVerify } from "jose";
import { compare } from "bcryptjs";
import { NextRequest } from "next/server";

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
 *  Returns null if unauthenticated. */
export function requireAuth(req: NextRequest): {
  userId: number;
  role: string;
} | null {
  const userId = req.headers.get("x-user-id");
  const role = req.headers.get("x-user-role");
  if (!userId || !role) return null;
  return { userId: parseInt(userId, 10), role };
}
