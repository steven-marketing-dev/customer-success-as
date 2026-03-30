import { NextRequest, NextResponse } from "next/server";
import { runPipeline } from "@/lib/pipeline";
import {
  getJobState,
  startJob,
  appendLog,
  updateProgress,
  finishJob,
  failJob,
} from "@/lib/jobRunner";

export const dynamic = "force-dynamic";
export const maxDuration = 5; // Returns immediately after starting

export async function POST(req: NextRequest) {
  const { mode = "incremental", testLimit } = await req.json() as { mode?: string; testLimit?: number };

  if (!["incremental", "full", "recluster", "test", "scrape-kb", "extract-loom"].includes(mode)) {
    return NextResponse.json({ error: "Invalid mode" }, { status: 400 });
  }

  const state = getJobState();
  if (state.status === "running") {
    return NextResponse.json({ error: "Pipeline already running" }, { status: 409 });
  }

  startJob(mode);

  // Fire and forget — keeps running even after this request returns
  runPipeline({
    mode: mode as "incremental" | "full" | "recluster" | "test" | "scrape-kb",
    testLimit: mode === "test" ? (testLimit ?? 3) : undefined,
    onProgress: (event) => {
      if (event.type === "log") appendLog(event.message);
      else if (event.type === "progress") updateProgress(event.current, event.total, event.message);
      else if (event.type === "done") finishJob(event.stats);
      else if (event.type === "error") failJob(event.message);
    },
  }).catch((err) => {
    failJob(String(err));
  });

  return NextResponse.json({ ok: true });
}
