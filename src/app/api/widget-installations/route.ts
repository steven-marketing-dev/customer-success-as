import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { Repository } from "@/lib/db/repository";
import { requireAuth } from "@/lib/auth";

function requireMaster(req: NextRequest): { ok: true } | { ok: false; response: NextResponse } {
  const session = requireAuth(req);
  if (!session) return { ok: false, response: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  if (session.role !== "master") return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { ok: true };
}

function generateKey(): string {
  return "cs_" + crypto.randomBytes(18).toString("base64url");
}

export async function GET(req: NextRequest) {
  const gate = requireMaster(req);
  if (!gate.ok) return gate.response;
  const repo = new Repository();
  return NextResponse.json(repo.listWidgetInstallations());
}

export async function POST(req: NextRequest) {
  const gate = requireMaster(req);
  if (!gate.ok) return gate.response;

  const body = await req.json() as {
    name?: string;
    allowed_origins?: string[];
    calendly_url?: string | null;
    knowledge_base_url?: string | null;
    product_name?: string | null;
    primary_color?: string | null;
    rate_limit_per_hour?: number;
    enable_chat?: boolean;
    enable_email?: boolean;
    enable_calendly?: boolean;
    enable_knowledge_base?: boolean;
  };

  const name = (body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });

  const origins = Array.isArray(body.allowed_origins)
    ? body.allowed_origins.map((o) => String(o).trim()).filter(Boolean)
    : [];

  const repo = new Repository();
  const installation = repo.createWidgetInstallation({
    key: generateKey(),
    name,
    allowed_origins: origins,
    calendly_url: body.calendly_url ?? null,
    knowledge_base_url: body.knowledge_base_url ?? null,
    product_name: body.product_name ?? null,
    primary_color: body.primary_color ?? null,
    rate_limit_per_hour: body.rate_limit_per_hour ?? 60,
    enable_chat: body.enable_chat ?? true,
    enable_email: body.enable_email ?? true,
    enable_calendly: body.enable_calendly ?? true,
    enable_knowledge_base: body.enable_knowledge_base ?? true,
  });

  return NextResponse.json(installation);
}
