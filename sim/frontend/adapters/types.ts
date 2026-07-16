/** Placeholder view-model types for Day 2 frontend. */
export interface TimelineItem {
  seq: number;
  label: string;
  type: string;
}

export interface AgentInspectorVm {
  id: string;
  name: string;
  cash: number;
  openGiftDebts: number;
}
