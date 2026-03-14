import { NextRequest, NextResponse } from "next/server";
import { writeFileSync } from "fs";
import path from "path";

export async function POST(req: NextRequest) {
  try {
    const secret = req.headers.get("x-upload-secret");
    if (secret !== process.env.DB_UPLOAD_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const data = await req.arrayBuffer();
    const dbPath = process.env.DATABASE_PATH || "./data/kb.db";
    const resolved = path.resolve(dbPath);

    // Close existing DB connection if any
    const globalAny = global as Record<string, unknown>;
    if (globalAny.__db) {
      try {
        (globalAny.__db as { close: () => void }).close();
      } catch {
        // ignore
      }
      globalAny.__db = undefined;
    }

    writeFileSync(resolved, Buffer.from(data));

    return NextResponse.json({
      ok: true,
      size: data.byteLength,
      path: resolved,
    });
  } catch (e) {
    return NextResponse.json(
      { error: String(e) },
      { status: 500 }
    );
  }
}
