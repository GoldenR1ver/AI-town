/**
 * Stratification & correlation analysis for experiment runs.
 *
 * Builds an agent feature matrix (cash/debt/emotion/prestige/face/occupation +
 * gift outcomes) and reports Pearson/Spearman correlations, occupation means,
 * quartile contrasts, and ranked lists — for theory-facing interpretation.
 *
 * Usage:
 *   npx tsx sim/backend/engine/analyze_stratification.ts [runId]
 *   RUN_ID=live100_365d_... npm run analyze:stratification
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AgentState,
  GiftRecord,
  RelationshipEdge,
  WorldSnapshot,
} from "../../shared/types/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const runsDir = join(__dirname, "../../data/runs");

export interface AgentFeatures {
  id: string;
  name: string;
  occupation: string;
  occupationClass: string;
  cash: number;
  deposit: number;
  debt: number;
  wealth: number;
  netWorth: number;
  income: number;
  face: number;
  prestige: number;
  reputation: number;
  mood: number;
  stress: number;
  energy: number;
  arousal: number;
  giftsIn: number;
  giftsOut: number;
  valueIn: number;
  valueOut: number;
  netGiftValue: number;
  defaults: number;
  degree: number;
  meanTrustOut: number;
  meanIntimacyOut: number;
  giftDebtOut: number;
}

export interface CorrPair {
  x: string;
  y: string;
  pearson: number;
  spearman: number;
  n: number;
}

export interface GroupStats {
  group: string;
  n: number;
  face: number;
  prestige: number;
  reputation: number;
  cash: number;
  wealth: number;
  debt: number;
  mood: number;
  stress: number;
  valueIn: number;
  valueOut: number;
  defaults: number;
  degree: number;
}

function round(n: number, d = 3): number {
  const p = 10 ** d;
  return Math.round(n * p) / p;
}

function mean(xs: number[]): number {
  if (!xs.length) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 3) return 0;
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i]! - mx;
    const b = ys[i]! - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  const den = Math.sqrt(dx * dy);
  return den === 0 ? 0 : num / den;
}

function rank(xs: number[]): number[] {
  const indexed = xs.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = new Array<number>(xs.length);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j + 1 < indexed.length && indexed[j + 1]!.v === indexed[i]!.v) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[indexed[k]!.i] = avg;
    i = j + 1;
  }
  return ranks;
}

function spearman(xs: number[], ys: number[]): number {
  return pearson(rank(xs), rank(ys));
}

function classifyOccupation(occ: string): string {
  if (/主任|书记|支书|干部|会长|村长/.test(occ)) return "干部/权威";
  if (/教师|医生|会计|文书/.test(occ)) return "白领/专业";
  if (/商人|店|老板|个体/.test(occ)) return "商业";
  if (/工|农|司机|厨师|保姆|服务|打工/.test(occ)) return "体力/服务";
  if (/退休/.test(occ)) return "退休";
  return "其他";
}

function slotIdx(f: string): number {
  const m = f.match(/D(\d+)-(AM|PM|EVE)/);
  if (!m) return 0;
  return +m[1]! * 3 + ({ AM: 0, PM: 1, EVE: 2 }[m[2] as "AM" | "PM" | "EVE"] ?? 0);
}

function loadFinalSnapshot(runDir: string): WorldSnapshot {
  const dir = join(runDir, "snapshots");
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort((a, b) => slotIdx(a) - slotIdx(b));
  if (!files.length) throw new Error(`no snapshots in ${dir}`);
  return JSON.parse(readFileSync(join(dir, files[files.length - 1]!), "utf8")) as WorldSnapshot;
}

function resolveRunId(arg?: string): string {
  const requested = arg ?? process.env.RUN_ID;
  if (requested) {
    const namedPath = join(runsDir, "NAMED_RUNS.json");
    if (existsSync(namedPath)) {
      const named = JSON.parse(readFileSync(namedPath, "utf8")) as Record<
        string,
        { runId?: string }
      >;
      if (named[requested]?.runId) return named[requested]!.runId!;
    }
    if (existsSync(join(runsDir, requested))) return requested;
    return requested;
  }
  for (const ptr of ["LATEST_TEST1.txt", "LATEST_GOLD_RUN.txt", "LATEST_P5_RUN.txt"]) {
    const p = join(runsDir, ptr);
    if (existsSync(p)) return readFileSync(p, "utf8").trim();
  }
  throw new Error("No runId. Pass as argv or set RUN_ID / LATEST_GOLD_RUN.txt");
}

export function buildAgentFeatures(
  agents: Record<string, AgentState>,
  gifts: GiftRecord[],
  edges: RelationshipEdge[],
): AgentFeatures[] {
  return Object.values(agents).map((a) => {
    const id = a.public.id;
    const received = gifts.filter((g) => g.to === id);
    const given = gifts.filter((g) => g.from === id);
    const outEdges = edges.filter((e) => e.from === id);
    const cash = a.economy.cash;
    const deposit = a.economy.deposit;
    const debt = a.economy.debt;
    const wealth = cash + deposit;
    const valueIn = received.reduce((s, g) => s + g.value, 0);
    const valueOut = given.reduce((s, g) => s + g.value, 0);
    return {
      id,
      name: a.public.name,
      occupation: a.public.occupation,
      occupationClass: classifyOccupation(a.public.occupation),
      cash,
      deposit,
      debt,
      wealth,
      netWorth: wealth - debt,
      income: a.economy.income,
      face: a.public.face ?? 50,
      prestige: a.public.prestige ?? 50,
      reputation: a.public.reputation ?? 50,
      mood: a.private.emotion.mood,
      stress: a.private.emotion.stress,
      energy: a.private.emotion.energy,
      arousal: a.private.emotion.arousal,
      giftsIn: received.length,
      giftsOut: given.length,
      valueIn,
      valueOut,
      netGiftValue: valueIn - valueOut,
      defaults: received.filter((g) => g.status === "defaulted").length,
      degree: outEdges.length,
      meanTrustOut: outEdges.length ? mean(outEdges.map((e) => e.trust)) : 0,
      meanIntimacyOut: outEdges.length ? mean(outEdges.map((e) => e.intimacy)) : 0,
      giftDebtOut: outEdges.reduce((s, e) => s + Math.max(0, e.giftDebt), 0),
    };
  });
}

const FEATURE_KEYS = [
  "cash",
  "wealth",
  "debt",
  "netWorth",
  "income",
  "face",
  "prestige",
  "reputation",
  "mood",
  "stress",
  "energy",
  "valueIn",
  "valueOut",
  "netGiftValue",
  "defaults",
  "degree",
  "giftDebtOut",
] as const;

type FeatureKey = (typeof FEATURE_KEYS)[number];

function col(rows: AgentFeatures[], key: FeatureKey): number[] {
  return rows.map((r) => r[key]);
}

function correlationMatrix(rows: AgentFeatures[]): CorrPair[] {
  const pairs: CorrPair[] = [];
  for (let i = 0; i < FEATURE_KEYS.length; i++) {
    for (let j = i + 1; j < FEATURE_KEYS.length; j++) {
      const x = FEATURE_KEYS[i]!;
      const y = FEATURE_KEYS[j]!;
      const xs = col(rows, x);
      const ys = col(rows, y);
      pairs.push({
        x,
        y,
        pearson: round(pearson(xs, ys)),
        spearman: round(spearman(xs, ys)),
        n: rows.length,
      });
    }
  }
  return pairs.sort(
    (a, b) => Math.abs(b.pearson) - Math.abs(a.pearson) || Math.abs(b.spearman) - Math.abs(a.spearman),
  );
}

function groupByOccupation(rows: AgentFeatures[]): GroupStats[] {
  const map = new Map<string, AgentFeatures[]>();
  for (const r of rows) {
    const list = map.get(r.occupationClass) ?? [];
    list.push(r);
    map.set(r.occupationClass, list);
  }
  return [...map.entries()]
    .map(([group, list]) => ({
      group,
      n: list.length,
      face: round(mean(list.map((r) => r.face)), 1),
      prestige: round(mean(list.map((r) => r.prestige)), 1),
      reputation: round(mean(list.map((r) => r.reputation)), 1),
      cash: round(mean(list.map((r) => r.cash)), 0),
      wealth: round(mean(list.map((r) => r.wealth)), 0),
      debt: round(mean(list.map((r) => r.debt)), 0),
      mood: round(mean(list.map((r) => r.mood)), 2),
      stress: round(mean(list.map((r) => r.stress)), 2),
      valueIn: round(mean(list.map((r) => r.valueIn)), 0),
      valueOut: round(mean(list.map((r) => r.valueOut)), 0),
      defaults: round(mean(list.map((r) => r.defaults)), 2),
      degree: round(mean(list.map((r) => r.degree)), 1),
    }))
    .sort((a, b) => b.prestige - a.prestige);
}

function quartileCut(rows: AgentFeatures[], key: FeatureKey): {
  label: string;
  low: GroupStats;
  high: GroupStats;
  gaps: Record<string, number>;
} {
  const sorted = [...rows].sort((a, b) => a[key] - b[key]);
  const q = Math.max(1, Math.floor(sorted.length / 4));
  const lowRows = sorted.slice(0, q);
  const highRows = sorted.slice(-q);
  const summarize = (group: string, list: AgentFeatures[]): GroupStats => ({
    group,
    n: list.length,
    face: round(mean(list.map((r) => r.face)), 1),
    prestige: round(mean(list.map((r) => r.prestige)), 1),
    reputation: round(mean(list.map((r) => r.reputation)), 1),
    cash: round(mean(list.map((r) => r.cash)), 0),
    wealth: round(mean(list.map((r) => r.wealth)), 0),
    debt: round(mean(list.map((r) => r.debt)), 0),
    mood: round(mean(list.map((r) => r.mood)), 2),
    stress: round(mean(list.map((r) => r.stress)), 2),
    valueIn: round(mean(list.map((r) => r.valueIn)), 0),
    valueOut: round(mean(list.map((r) => r.valueOut)), 0),
    defaults: round(mean(list.map((r) => r.defaults)), 2),
    degree: round(mean(list.map((r) => r.degree)), 1),
  });
  const low = summarize(`Q1低${key}`, lowRows);
  const high = summarize(`Q4高${key}`, highRows);
  const gaps: Record<string, number> = {
    face: round(high.face - low.face, 1),
    prestige: round(high.prestige - low.prestige, 1),
    wealth: round(high.wealth - low.wealth, 0),
    valueIn: round(high.valueIn - low.valueIn, 0),
    stress: round(high.stress - low.stress, 2),
    degree: round(high.degree - low.degree, 1),
  };
  return { label: key, low, high, gaps };
}

function topBottom(
  rows: AgentFeatures[],
  key: FeatureKey,
  k = 8,
): { top: AgentFeatures[]; bottom: AgentFeatures[] } {
  const sorted = [...rows].sort((a, b) => b[key] - a[key]);
  return { top: sorted.slice(0, k), bottom: sorted.slice(-k).reverse() };
}

function interpretInsights(
  topCorr: CorrPair[],
  byOcc: GroupStats[],
  qPrestige: ReturnType<typeof quartileCut>,
  qWealth: ReturnType<typeof quartileCut>,
): string[] {
  const tips: string[] = [];
  const strong = topCorr.filter((c) => Math.abs(c.pearson) >= 0.4 || Math.abs(c.spearman) >= 0.4);
  for (const c of strong.slice(0, 8)) {
    const dir = c.pearson >= 0 ? "正" : "负";
    tips.push(
      `${c.x} ↔ ${c.y}：Pearson=${c.pearson} / Spearman=${c.spearman}（${dir}相关）`,
    );
  }
  if (byOcc.length >= 2) {
    const top = byOcc[0]!;
    const bot = byOcc[byOcc.length - 1]!;
    tips.push(
      `职业分层：${top.group} prestige均值=${top.prestige}、收礼=${top.valueIn}；${bot.group} prestige=${bot.prestige}、收礼=${bot.valueIn}`,
    );
  }
  tips.push(
    `声望四分位：高声望组比低声望组多收礼 ${qPrestige.gaps.valueIn}，face差 ${qPrestige.gaps.face}，网络度数差 ${qPrestige.gaps.degree}`,
  );
  tips.push(
    `财富四分位：高财富组 vs 低财富组 prestige差 ${qWealth.gaps.prestige}，收礼差 ${qWealth.gaps.valueIn}（检验「钱→礼」还是「位→礼」）`,
  );
  const facePrestige = topCorr.find((c) =>
    (c.x === "face" && c.y === "prestige") || (c.x === "prestige" && c.y === "face"),
  );
  if (facePrestige) {
    tips.push(
      `脸面-声望耦合 ${facePrestige.pearson}：二者同向说明公开地位与短期面子共变，而非完全脱钩`,
    );
  }
  return tips;
}

function slimRank(rows: AgentFeatures[]) {
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    occupation: r.occupation,
    occupationClass: r.occupationClass,
    cash: round(r.cash, 0),
    debt: round(r.debt, 0),
    wealth: round(r.wealth, 0),
    face: round(r.face, 1),
    prestige: round(r.prestige, 1),
    mood: round(r.mood, 2),
    stress: round(r.stress, 2),
    valueIn: round(r.valueIn, 0),
    valueOut: round(r.valueOut, 0),
    defaults: r.defaults,
    degree: r.degree,
  }));
}

export function analyzeStratification(runId: string) {
  const runDir = join(runsDir, runId);
  if (!existsSync(runDir)) throw new Error(`run not found: ${runDir}`);
  const snap = loadFinalSnapshot(runDir);
  const rows = buildAgentFeatures(snap.agents, snap.giftLedger, snap.relationships);
  const corr = correlationMatrix(rows);
  const byOccupation = groupByOccupation(rows);
  const qPrestige = quartileCut(rows, "prestige");
  const qWealth = quartileCut(rows, "wealth");
  const qFace = quartileCut(rows, "face");
  const qStress = quartileCut(rows, "stress");

  const rankings = {
    byCash: slimRank(topBottom(rows, "cash").top),
    byDebt: slimRank(topBottom(rows, "debt").top),
    byPrestige: slimRank(topBottom(rows, "prestige").top),
    byFace: slimRank(topBottom(rows, "face").top),
    byFaceLow: slimRank(topBottom(rows, "face").bottom),
    byStress: slimRank(topBottom(rows, "stress").top),
    byValueIn: slimRank(topBottom(rows, "valueIn").top),
    byNetGift: slimRank(topBottom(rows, "netGiftValue").top),
  };

  const insights = interpretInsights(corr, byOccupation, qPrestige, qWealth);

  const report = {
    runId,
    generatedAt: new Date().toISOString(),
    agentCount: rows.length,
    giftCount: snap.giftLedger.length,
    edgeCount: snap.relationships.length,
    insights,
    topCorrelations: corr.slice(0, 20),
    statusCorrelations: corr.filter(
      (c) =>
        ["face", "prestige", "reputation", "wealth", "cash", "debt", "valueIn", "stress", "mood"].includes(
          c.x,
        ) &&
        ["face", "prestige", "reputation", "wealth", "cash", "debt", "valueIn", "stress", "mood"].includes(
          c.y,
        ),
    ),
    byOccupation,
    quartiles: {
      prestige: qPrestige,
      wealth: qWealth,
      face: qFace,
      stress: qStress,
    },
    rankings,
    agents: slimRank(rows.sort((a, b) => b.prestige - a.prestige)),
  };

  const outPath = join(runDir, "stratification_analysis.json");
  writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
  return { report, outPath };
}

function main() {
  const runId = resolveRunId(process.argv[2]);
  const { report, outPath } = analyzeStratification(runId);
  console.log(`Wrote ${outPath}`);
  console.log(`agents=${report.agentCount} gifts=${report.giftCount} edges=${report.edgeCount}`);
  console.log("\nInsights:");
  for (const tip of report.insights) console.log(`- ${tip}`);
  console.log("\nTop correlations:");
  for (const c of report.topCorrelations.slice(0, 10)) {
    console.log(`  ${c.x}↔${c.y}  r=${c.pearson}  ρ=${c.spearman}`);
  }
  console.log("\nOccupation strata:");
  for (const g of report.byOccupation) {
    console.log(
      `  ${g.group} n=${g.n} prestige=${g.prestige} face=${g.face} wealth=${g.wealth} valueIn=${g.valueIn}`,
    );
  }
}

main();
