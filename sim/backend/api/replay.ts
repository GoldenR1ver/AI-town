/**
 * Replay HTTP/API surface — backed by ReplayEngine (D2).
 */
export { ReplayEngine, listRunIds } from "../store/replay_engine.js";
export type { ReplayIndexRow } from "../store/replay_engine.js";

export interface ReplayApi {
  loadExperiment(runId: string): void;
  seekToSeq(seq: number): unknown;
  listRuns(): string[];
}
