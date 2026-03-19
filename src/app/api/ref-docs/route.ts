import { NextRequest, NextResponse } from "next/server";
import { Repository } from "@/lib/db/repository";
import { rebuildFtsIndexes } from "@/lib/db/index";
import { fetchGoogleDoc } from "@/lib/gdoc-importer";

export async function GET() {
  const repo = new Repository();
  const docs = repo.getAllRefDocs();
  return NextResponse.json(docs);
}

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    title: string;
    source_type: "google_doc" | "manual";
    source_url?: string;
  };

  if (!body.title?.trim()) {
    return NextResponse.json({ error: "Title is required" }, { status: 400 });
  }

  const repo = new Repository();
  const doc = repo.createRefDoc({
    title: body.title.trim(),
    source_type: body.source_type ?? "manual",
    source_url: body.source_url?.trim() || null,
  });

  // Auto-import sections from Google Doc
  if (body.source_type === "google_doc" && body.source_url) {
    try {
      const result = await fetchGoogleDoc(body.source_url);
      // Update title from doc if the user just used a placeholder
      if (result.title && result.title !== body.title.trim()) {
        repo.updateRefDoc(doc.id, { title: result.title });
      }
      for (let i = 0; i < result.sections.length; i++) {
        repo.createRefDocSection({
          doc_id: doc.id,
          heading: result.sections[i].heading,
          content: result.sections[i].content,
          section_order: i,
        });
      }
    } catch (err) {
      // Return the doc but note the import error
      return NextResponse.json({
        ...repo.getRefDocById(doc.id),
        section_count: 0,
        import_error: String(err),
      });
    }
  }

  // Rebuild FTS after importing sections
  rebuildFtsIndexes();

  // Return doc with section count
  const docs = repo.getAllRefDocs();
  const created = docs.find((d) => d.id === doc.id);
  return NextResponse.json(created ?? doc);
}
