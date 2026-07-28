/**
 * Discourse-alignment checker: utterance tone vs speaker stress/mood/personality.
 *
 * Usage:
 *   npx tsx sim/backend/engine/analyze_discourse_alignment.ts [runId]
 *   npm run analyze:discourse -- test1
 *
 * Writes discourse_alignment_report.json under the run directory.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { LogEntry } from "../../shared/types/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const runsDir = join(__dirname, "../../data/runs");

const INVITE_PAY =
  /请客|做东|我请|我出|随礼.*多|再加|包圆|一定要来|务必来|一定来|主动.*送|多送/;
const COLD_OR_REFUSE =
  /改日|下次|手头紧|实在|不好意思|推脱|算了|不去了|去不了|没空|累了|没劲/;
const WARM_FACE =
  /亲爱的|太好了|一定帮忙|全力|随便花|包在我身上|万分荣幸/;
const GOSSIP_BACK =
  /背后|听说他|这人真|真讨厌|别提他|阴着/;

interface MsgPayload {
  speakerId?: string;
  text?: string;
  meta?: { sentiment?: number; politeness?: number };
  speakerEmotion?: { mood?: number; stress?: number; energy?: number };
  speakerPersonality?: { introversion?: number; spitefulness?: number };
}

interface Finding {
  rule: string;
  severity: "warn" | "info";
  speakerId: string;
  text: string;
  detail: string;
  simTime?: LogEntry["simTime"];
}

function main(): void {
  const runIdArg = process.argv[2];
  let runId = runIdArg;
  if (!runId) {
    const latest = join(runsDir, "LATEST_GOLD_RUN.txt");
    if (existsSync(latest)) runId = readFileSync(latest, "utf8").trim();
  }
  if (!runId) throw new Error("usage: analyze_discourse_alignment.ts <runId>");

  const runDir = join(runsDir, runId);
  const logPath = join(runDir, "event_log.jsonl");
  if (!existsSync(logPath)) throw new Error(`missing ${logPath}`);

  const logs = readFileSync(logPath, "utf8")
    .split(/\n/)
    .filter(Boolean)
    .map((l) => JSON.parse(l) as LogEntry);

  const messages = logs.filter((l) => l.type === "dialogue.message");
  const findings: Finding[] = [];
  let scored = 0;
  let aligned = 0;

  for (const entry of messages) {
    const p = entry.payload as MsgPayload;
    const text = String(p.text ?? "");
    const speakerId = String(p.speakerId ?? "?");
    const em = p.speakerEmotion;
    const pers = p.speakerPersonality;
    const sentiment = p.meta?.sentiment ?? 0;
    if (!em) continue;
    scored += 1;
    let ok = true;

    // High stress should not sound eager to host/pay.
    if ((em.stress ?? 0) >= 0.65 && INVITE_PAY.test(text)) {
      ok = false;
      findings.push({
        rule: "stress_vs_invite_pay",
        severity: "warn",
        speakerId,
        text: text.slice(0, 80),
        detail: `stress=${em.stress?.toFixed(2)} but utterance invites/pays`,
        simTime: entry.simTime,
      });
    }

    // High stress / low energy: cold/refuse language is aligned (info only if present).
    if (
      ((em.stress ?? 0) >= 0.65 || (em.energy ?? 1) <= 0.35) &&
      COLD_OR_REFUSE.test(text)
    ) {
      findings.push({
        rule: "stress_refuse_ok",
        severity: "info",
        speakerId,
        text: text.slice(0, 80),
        detail: "高压/低精力下推脱用语，符合对齐",
        simTime: entry.simTime,
      });
    }

    // Introvert should not lead with high-arousal warm hosting.
    if ((pers?.introversion ?? 0) >= 0.62 && WARM_FACE.test(text) && sentiment > 0.55) {
      ok = false;
      findings.push({
        rule: "introvert_vs_warm_host",
        severity: "warn",
        speakerId,
        text: text.slice(0, 80),
        detail: `introversion=${pers?.introversion?.toFixed(2)} but warm hosting tone`,
        simTime: entry.simTime,
      });
    }

    // Spiteful: gossip/backbiting is allowed; overly warm to disliked peers flagged via sentiment only if extreme.
    if ((pers?.spitefulness ?? 0) >= 0.55 && GOSSIP_BACK.test(text)) {
      findings.push({
        rule: "spite_gossip_ok",
        severity: "info",
        speakerId,
        text: text.slice(0, 80),
        detail: "记仇性格下的背后议论，符合对齐",
        simTime: entry.simTime,
      });
    }

    // Low mood + very positive sentiment mismatch.
    if ((em.mood ?? 0.5) <= 0.3 && sentiment >= 0.7) {
      ok = false;
      findings.push({
        rule: "mood_vs_sentiment",
        severity: "warn",
        speakerId,
        text: text.slice(0, 80),
        detail: `mood=${em.mood?.toFixed(2)} but sentiment=${sentiment.toFixed(2)}`,
        simTime: entry.simTime,
      });
    }

    if (ok) aligned += 1;
  }

  const warns = findings.filter((f) => f.severity === "warn");
  const rate = scored ? aligned / scored : NaN;
  const report = {
    runId,
    generatedAt: new Date().toISOString(),
    totals: {
      dialogueMessages: messages.length,
      withEmotionSnapshot: scored,
      alignedApprox: aligned,
      alignmentRate: Number.isFinite(rate) ? Number(rate.toFixed(3)) : null,
      warnFindings: warns.length,
      infoFindings: findings.length - warns.length,
    },
    note:
      scored === 0
        ? "本 run 的 dialogue.message 无 speakerEmotion（对齐日志为新字段）。请用新代码再跑短实验后复检。"
        : "启发式检查：warn 为疑似不对齐，info 为符合预期的表达。",
    topWarns: warns.slice(0, 40),
    sampleInfo: findings.filter((f) => f.severity === "info").slice(0, 15),
  };

  const out = join(runDir, "discourse_alignment_report.json");
  writeFileSync(out, JSON.stringify(report, null, 2), "utf8");
  console.log(
    JSON.stringify(
      {
        runId,
        withEmotion: scored,
        alignmentRate: report.totals.alignmentRate,
        warns: warns.length,
        out,
      },
      null,
      2,
    ),
  );
}

main();
