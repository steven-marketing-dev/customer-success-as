import { NextRequest, NextResponse } from "next/server";
import { getDb, rebuildFtsIndexes } from "@/lib/db/index";
import { requireAuth } from "@/lib/auth";
import { acquireJob, releaseJob, runningJobs } from "@/lib/locks";

/**
 * Master-only: delete all tickets, Q&A pairs and categories (the pipeline's output). Glossary,
 * articles, rules, reference docs and widget data stay.
 *
 * Refused while the pipeline, the KB sync or the report job is running. Leaves the rest of the
 * data coherent (DIS-412): categories that a behavioral rule points to are kept (empty) so the
 * rule keeps its category, gaps whose answer was one of the deleted Q&A go back to the gap
 * queue, and the search indexes are rebuilt.
 */
export async function POST(req: NextRequest) {
  const session = requireAuth(req);
  if (!session) return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
  if (session.role !== "master") return NextResponse.json({ ok: false, error: "Only an admin can clear the database" }, { status: 403 });

  const busy = runningJobs().map((j) => j.name);
  if (busy.length > 0 || !acquireJob("db-clear")) {
    return NextResponse.json({ ok: false, error: `A job is running (${busy.join(", ") || "db-clear"}). Try again when it finishes.` }, { status: 409 });
  }
  try {
    const db = getDb();
    db.transaction(() => {
      db.exec(`
        DELETE FROM qa_category_map;
        DELETE FROM qa_pairs;
        DELETE FROM categories WHERE id NOT IN (SELECT category_id FROM behavioral_cards WHERE category_id IS NOT NULL);
        UPDATE categories SET qa_count = 0;
        DELETE FROM tickets;
        DELETE FROM sync_state;
        DELETE FROM widget_gap_reviews WHERE status = 'answered';
      `);
    })();
    rebuildFtsIndexes(db);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  } finally {
    releaseJob("db-clear");
  }
}
