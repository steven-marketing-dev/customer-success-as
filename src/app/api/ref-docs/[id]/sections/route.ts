import { NextRequest, NextResponse } from "next/server";
import { Repository } from "@/lib/db/repository";
import { fetchGoogleDoc } from "@/lib/gdoc-importer";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const docId = parseInt(id, 10);
  const repo = new Repository();

  const doc = repo.getRefDocById(docId);
  if (!doc) return NextResponse.json({ error: "Doc not found" }, { status: 404 });

  const body = await req.json() as { heading: string; content: string; section_order?: number };
  if (!body.heading?.trim() || !body.content?.trim()) {
    return NextResponse.json({ error: "Heading and content are required" }, { status: 400 });
  }

  const existingSections = repo.getRefDocSections(docId);
  const order = body.section_order ?? existingSections.length;

  const section = repo.createRefDocSection({
    doc_id: docId,
    heading: body.heading.trim(),
    content: body.content.trim(),
    section_order: order,
  });
  return NextResponse.json(section);
}

/** Re-import all sections from Google Doc source URL */
export async function PUT(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const docId = parseInt(id, 10);
  const repo = new Repository();

  const doc = repo.getRefDocById(docId);
  if (!doc) return NextResponse.json({ error: "Doc not found" }, { status: 404 });
  if (doc.source_type !== "google_doc" || !doc.source_url) {
    return NextResponse.json({ error: "Not a Google Doc or no source URL" }, { status: 400 });
  }

  try {
    const result = await fetchGoogleDoc(doc.source_url);
    repo.clearRefDocSections(docId);

    for (let i = 0; i < result.sections.length; i++) {
      repo.createRefDocSection({
        doc_id: docId,
        heading: result.sections[i].heading,
        content: result.sections[i].content,
        section_order: i,
      });
    }

    if (result.title) {
      repo.updateRefDoc(docId, { title: result.title });
    }

    const sections = repo.getRefDocSections(docId);
    return NextResponse.json({ reimported: sections.length, sections });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
