import { NextRequest, NextResponse } from "next/server";
import { Repository } from "@/lib/db/repository";
import { requireAuth } from "@/lib/auth";

function requireMaster(req: NextRequest): { ok: true } | { ok: false; response: NextResponse } {
  const session = requireAuth(req);
  if (!session) return { ok: false, response: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  if (session.role !== "master") return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { ok: true };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = requireMaster(req);
  if (!gate.ok) return gate.response;
  const { id } = await params;
  const repo = new Repository();
  const installation = repo.getWidgetInstallationById(parseInt(id, 10));
  if (!installation) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const ratings = repo.getRecentWidgetRatings(installation.id, 25);
  return NextResponse.json({ installation, ratings });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = requireMaster(req);
  if (!gate.ok) return gate.response;
  const { id } = await params;
  const repo = new Repository();

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
    is_active?: boolean | number;
  };

  const fields: Parameters<Repository["updateWidgetInstallation"]>[1] = {};
  if (body.name !== undefined) fields.name = body.name.trim();
  if (body.allowed_origins !== undefined) fields.allowed_origins = body.allowed_origins.map((o) => String(o).trim()).filter(Boolean);
  if (body.calendly_url !== undefined) fields.calendly_url = body.calendly_url;
  if (body.knowledge_base_url !== undefined) fields.knowledge_base_url = body.knowledge_base_url;
  if (body.product_name !== undefined) fields.product_name = body.product_name;
  if (body.primary_color !== undefined) fields.primary_color = body.primary_color;
  if (body.rate_limit_per_hour !== undefined) fields.rate_limit_per_hour = body.rate_limit_per_hour;
  if (body.enable_chat !== undefined) fields.enable_chat = body.enable_chat ? 1 : 0;
  if (body.enable_email !== undefined) fields.enable_email = body.enable_email ? 1 : 0;
  if (body.enable_calendly !== undefined) fields.enable_calendly = body.enable_calendly ? 1 : 0;
  if (body.enable_knowledge_base !== undefined) fields.enable_knowledge_base = body.enable_knowledge_base ? 1 : 0;
  if (body.is_active !== undefined) fields.is_active = body.is_active ? 1 : 0;

  const updated = repo.updateWidgetInstallation(parseInt(id, 10), fields);
  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(updated);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = requireMaster(req);
  if (!gate.ok) return gate.response;
  const { id } = await params;
  const repo = new Repository();
  repo.deleteWidgetInstallation(parseInt(id, 10));
  return NextResponse.json({ ok: true });
}
