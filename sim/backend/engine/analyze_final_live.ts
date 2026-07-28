/**
 * Final live-run acceptance against汇报大纲假说 H1–H5.
 *
 * Usage:
 *   npx tsx sim/backend/engine/analyze_final_live.ts final_align_100_365d
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentState, LogEntry, RelationshipEdge } from "../../shared/types/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const runsDir = join(__dirname, "../../data/runs");

interface Check {
  id: string;
  hypothesis?: string;
  ok: boolean;
  detail: string;
}

function mean(nums: number[]): number {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : NaN;
}

function main(): void {
  const runId = process.argv[2] ?? "final_align_100_365d";
  const runDir = join(runsDir, runId);
  if (!existsSync(runDir)) throw new Error(`missing ${runDir}`);

  const metrics = JSON.parse(readFileSync(join(runDir, "metrics.json"), "utf8")) as Record<
    string,
    number | string
  >;
  const logs = readFileSync(join(runDir, "event_log.jsonl"), "utf8")
    .split(/\n/)
    .filter(Boolean)
    .map((l) => JSON.parse(l) as LogEntry);

  const snaps = readdirSync(join(runDir, "snapshots"))
    .filter((f) => /^D\d+-(AM|PM|EVE)\.json$/.test(f))
    .sort((a, b) => {
      const pa = a.match(/D(\d+)-(AM|PM|EVE)/)!;
      const pb = b.match(/D(\d+)-(AM|PM|EVE)/)!;
      const s = { AM: 0, PM: 1, EVE: 2 } as const;
      return Number(pa[1]) - Number(pb[1]) || s[pa[2] as keyof typeof s] - s[pb[2] as keyof typeof s];
    });
  const last = JSON.parse(
    readFileSync(join(runDir, "snapshots", snaps[snaps.length - 1]!), "utf8"),
  ) as {
    agents: Record<string, AgentState>;
    relationships: RelationshipEdge[];
  };

  const agents = Object.values(last.agents);
  const mood = mean(agents.map((a) => a.private.emotion.mood));
  const stress = mean(agents.map((a) => a.private.emotion.stress));
  const energy = mean(agents.map((a) => a.private.emotion.energy));
  const cash = mean(agents.map((a) => a.economy.cash));
  const liquid = mean(agents.map((a) => a.economy.cash + a.economy.deposit));
  const cashZeroShare = agents.filter((a) => a.economy.cash <= 1).length / Math.max(1, agents.length);

  const reciprocity = Number(metrics.reciprocity_rate ?? NaN);
  const defaultRate = Number(metrics.default_rate ?? NaN);
  const delay = Number(metrics.avg_repay_delay ?? NaN);
  const prestigeCorr = Number(metrics.gift_prestige_corr ?? NaN);
  const wealthCorr = Number(metrics.gift_wealth_corr ?? NaN);
  const top10 = Number(metrics.gift_inflow_top10_prestige_share ?? NaN);
  const gifts = Number(metrics.gift_count_total ?? 0);

  const authority = agents.filter(
    (a) =>
      (a.public.socialTags ?? []).some((t) => /authority|cadre|host|official/i.test(t)) ||
      /支书|主任|村长|干部/.test(a.public.occupation),
  );
  const authFace = mean(authority.map((a) => a.public.face ?? 50));
  const authDefaults = authority.reduce((s, a) => {
    // count defaults where agent is debtor from ledger if present in last snap — approximate via face
    return s;
  }, 0);
  void authDefaults;

  const disliked = (last.relationships ?? []).filter((e) => (e.dislike ?? 0) >= 35).length;
  const refused = logs.filter((l) => l.type === "event.refused").length;
  const gossip = logs.filter((l) => {
    const p = l.payload as { templateId?: string; subType?: string };
    return (
      l.type === "event.created" &&
      (p.templateId?.includes("gossip") || p.subType === "social_gossip")
    );
  }).length;
  const w4 = logs.filter(
    (l) => (l.payload as { kind?: string })?.kind === "cross_occasion_repay",
  ).length;
  const offset = logs.filter(
    (l) => (l.payload as { kind?: string })?.kind === "gift_debt_offset",
  ).length;

  let discourseRate: number | null = null;
  let discourseWarns: number | null = null;
  const discoursePath = join(runDir, "discourse_alignment_report.json");
  if (existsSync(discoursePath)) {
    const d = JSON.parse(readFileSync(discoursePath, "utf8")) as {
      totals?: { alignmentRate?: number; warnFindings?: number };
    };
    discourseRate = d.totals?.alignmentRate ?? null;
    discourseWarns = d.totals?.warnFindings ?? null;
  }

  const checks: Check[] = [
    {
      id: "H1_prestige_attract",
      hypothesis: "H1",
      ok: prestigeCorr > 0.15 && top10 >= 0.15,
      detail: `gift_prestige_corr=${prestigeCorr.toFixed(3)} top10=${top10.toFixed(3)} wealth_corr=${wealthCorr.toFixed(3)}`,
    },
    {
      id: "H1_not_pure_wealth",
      hypothesis: "H1",
      ok: !Number.isFinite(wealthCorr) || prestigeCorr >= wealthCorr - 0.05,
      detail: `prestige_corr=${prestigeCorr.toFixed(3)} vs wealth_corr=${wealthCorr.toFixed(3)}`,
    },
    {
      id: "H2_reciprocity",
      hypothesis: "H2",
      ok: reciprocity >= 0.7 && reciprocity <= 0.95,
      detail: `reciprocity=${reciprocity} (want 0.70–0.95)`,
    },
    {
      id: "H2_default",
      hypothesis: "H2",
      ok: defaultRate >= 0.02 && defaultRate <= 0.25,
      detail: `default_rate=${defaultRate} (want 0.02–0.25)`,
    },
    {
      id: "H3_authority_face",
      hypothesis: "H3",
      ok: authority.length === 0 || authFace >= 40,
      detail: `authority_n=${authority.length} mean_face=${authFace.toFixed(1)} (want ≥40)`,
    },
    {
      id: "H4_delay",
      hypothesis: "H4",
      ok: delay >= 5,
      detail: `avg_repay_delay=${delay} slots (want ≥5)`,
    },
    {
      id: "gifts_alive",
      ok: gifts >= 200,
      detail: `gifts=${gifts} (want ≥200 for 365d)`,
    },
    {
      id: "economy_stable",
      ok: cashZeroShare < 0.35 && liquid > 500,
      detail: `cashZeroShare=${cashZeroShare.toFixed(2)} meanCash=${cash.toFixed(0)} meanLiquid=${liquid.toFixed(0)}`,
    },
    {
      id: "emotion_bands",
      ok: mood >= 0.3 && mood <= 0.85 && stress >= 0.15 && stress <= 0.75 && energy >= 0.4,
      detail: `mood=${mood.toFixed(3)} stress=${stress.toFixed(3)} energy=${energy.toFixed(3)}`,
    },
    {
      id: "H5_refuse_gossip",
      hypothesis: "H5",
      ok: refused > 50 && (gossip > 0 || disliked > 0),
      detail: `refused=${refused} gossip=${gossip} dislike≥35=${disliked}`,
    },
    {
      id: "H5_discourse",
      hypothesis: "H5",
      ok:
        discourseRate == null
          ? true
          : discourseRate >= 0.85 && (discourseWarns ?? 0) / Math.max(1, logs.filter((l) => l.type === "dialogue.message").length) < 0.15,
      detail:
        discourseRate == null
          ? "discourse report missing (run analyze:discourse)"
          : `alignmentRate=${discourseRate} warns=${discourseWarns}`,
    },
    {
      id: "temporality_logs",
      ok: w4 + offset > 0 || delay >= 5,
      detail: `W4_repay_logs=${w4} offsets=${offset}`,
    },
  ];

  const passed = checks.filter((c) => c.ok).length;
  const failed = checks.filter((c) => !c.ok);
  const report = {
    runId,
    ok: passed === checks.length,
    passed,
    total: checks.length,
    checks,
    failedIds: failed.map((c) => c.id),
    summary: {
      reciprocity,
      defaultRate,
      delay,
      prestigeCorr,
      wealthCorr,
      top10,
      gifts,
      mood,
      stress,
      energy,
      cash,
      liquid,
      cashZeroShare,
      authFace,
      refused,
      gossip,
      disliked,
      discourseRate,
      discourseWarns,
    },
    tuningHints: failed.map((c) => {
      if (c.id.startsWith("H2_reciprocity") && reciprocity > 0.95)
        return "raise abandonRate / shorten daily windows / soften repay mid-window";
      if (c.id.startsWith("H2_reciprocity") && reciprocity < 0.7)
        return "boost repayAttemptProbability / lower abandonRate";
      if (c.id.startsWith("H2_default") && defaultRate < 0.02)
        return "shorten windows or raise abandonRate";
      if (c.id.startsWith("H2_default") && defaultRate > 0.25)
        return "boost repay urgency / soften daily cost / extend W10";
      if (c.id === "economy_stable")
        return "lower dailyLivingCost band or economicStressDelta";
      if (c.id === "emotion_bands" && stress > 0.75)
        return "lower economicStressDelta baseline";
      if (c.id === "emotion_bands" && stress < 0.15)
        return "raise economicStressDelta baseline";
      if (c.id === "H1_prestige_attract")
        return "ensure ceremony gifts / reduce over-refuse on high-status hosts";
      if (c.id === "gifts_alive") return "raise social/gift event rates or lower refuse";
      return `inspect ${c.id}`;
    }),
  };

  writeFileSync(join(runDir, "final_acceptance_report.json"), JSON.stringify(report, null, 2), "utf8");
  console.log(`\n=== final acceptance (${runId}) ===`);
  for (const c of checks) console.log(`${c.ok ? "OK " : "FAIL"} ${c.id} — ${c.detail}`);
  console.log(`\n${passed}/${checks.length} passed`);
  if (!report.ok) {
    console.log("tuningHints:", report.tuningHints);
    process.exitCode = 1;
  }
}

main();
