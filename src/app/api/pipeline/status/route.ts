import { getJobState, getJobEmitter } from "@/lib/jobRunner";
import type { PipelineStats } from "@/lib/pipeline";

export const dynamic = "force-dynamic";

export async function GET() {
  const encoder = new TextEncoder();

  let cleanup: (() => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const send = (data: object) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch { /* client disconnected */ }
      };

      // Send full current state immediately so reconnecting clients see everything
      const current = getJobState();
      send({ type: "snapshot", ...current });

      // If not running, nothing more to stream
      if (current.status !== "running") {
        controller.close();
        return;
      }

      const emitter = getJobEmitter();

      const onLog = (message: string) => send({ type: "log", message });
      const onProgress = (data: { current: number; total: number; message: string }) =>
        send({ type: "progress", ...data });
      const onDone = (stats: PipelineStats) => {
        send({ type: "done", stats });
        doCleanup();
        controller.close();
      };
      const onError = (message: string) => {
        send({ type: "error", message });
        doCleanup();
        controller.close();
      };

      const doCleanup = () => {
        emitter.off("log", onLog);
        emitter.off("progress", onProgress);
        emitter.off("done", onDone);
        emitter.off("error", onError);
      };

      cleanup = doCleanup;

      emitter.on("log", onLog);
      emitter.on("progress", onProgress);
      emitter.on("done", onDone);
      emitter.on("error", onError);
    },
    cancel() {
      // Client navigated away — pipeline keeps running, just unsubscribe
      cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
