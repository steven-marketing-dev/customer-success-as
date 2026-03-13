import EventEmitter from "events";
import type { PipelineStats } from "./pipeline";

export interface JobState {
  status: "idle" | "running" | "done" | "error";
  mode: string | null;
  logs: string[];
  progress: { current: number; total: number } | null;
  stats: PipelineStats | null;
  startedAt: number | null;
  completedAt: number | null;
}

declare global {
  var __jobState: JobState | undefined;
  var __jobEmitter: EventEmitter | undefined;
}

function initState(): JobState {
  return {
    status: "idle",
    mode: null,
    logs: [],
    progress: null,
    stats: null,
    startedAt: null,
    completedAt: null,
  };
}

export function getJobState(): JobState {
  if (!global.__jobState) global.__jobState = initState();
  return global.__jobState;
}

export function getJobEmitter(): EventEmitter {
  if (!global.__jobEmitter) {
    global.__jobEmitter = new EventEmitter();
    global.__jobEmitter.setMaxListeners(100);
  }
  return global.__jobEmitter;
}

export function startJob(mode: string) {
  global.__jobState = { ...initState(), status: "running", mode, startedAt: Date.now() };
  getJobEmitter().emit("update");
}

export function appendLog(message: string) {
  const state = getJobState();
  state.logs = [...state.logs, message];
  getJobEmitter().emit("log", message);
}

export function updateProgress(current: number, total: number, message: string) {
  const state = getJobState();
  state.progress = { current, total };
  state.logs = [...state.logs, message];
  getJobEmitter().emit("progress", { current, total, message });
}

export function finishJob(stats: PipelineStats) {
  const state = getJobState();
  state.status = "done";
  state.stats = stats;
  state.completedAt = Date.now();
  state.progress = null;
  getJobEmitter().emit("done", stats);
}

export function failJob(message: string) {
  const state = getJobState();
  state.status = "error";
  state.completedAt = Date.now();
  state.logs = [...state.logs, `✗ ${message}`];
  getJobEmitter().emit("error", message);
}
