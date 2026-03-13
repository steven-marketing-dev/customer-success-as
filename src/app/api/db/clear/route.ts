import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/index";

export async function POST() {
  try {
    const db = getDb();
    db.exec(`
      DELETE FROM qa_category_map;
      DELETE FROM qa_pairs;
      DELETE FROM categories;
      DELETE FROM tickets;
      DELETE FROM sync_state;
    `);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
