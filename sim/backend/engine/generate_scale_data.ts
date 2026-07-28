/**
 * Generate scale village data:
 *   - 100 agents + sparse relationship graph
 *   - 500 public event templates
 *   - 500 random social (agent_driven) templates
 *
 * Usage: npm run data:generate-scale
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { EventTemplate } from "../../shared/types/event_template.js";
import type { RelationshipEdge, SocialBasis, RelationAxis } from "../../shared/types/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, "../../data");

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)]!;
}

function randInt(rng: () => number, lo: number, hi: number): number {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

const SURNAMES = [
  "赵", "钱", "孙", "李", "周", "吴", "郑", "王", "冯", "陈",
  "褚", "卫", "蒋", "沈", "韩", "杨", "朱", "秦", "尤", "许",
  "何", "吕", "施", "张", "孔", "曹", "严", "华", "金", "魏",
];
const GIVEN_M = ["建国", "明", "强", "伟", "军", "磊", "勇", "涛", "鹏", "辉", "德", "海", "刚", "斌", "杰"];
const GIVEN_F = ["秀兰", "芳", "丽", "霞", "静", "敏", "燕", "红", "梅", "萍", "娟", "英", "雪", "玲", "华"];

const OCCUPATIONS = [
  { occ: "村委会主任", tags: ["host", "authority", "community_leader"], wp: "village_committee", prestige: [65, 85], income: [5500, 7500] },
  { occ: "村委会文书", tags: ["public_service", "subordinate"], wp: "village_committee", prestige: [45, 60], income: [4000, 5200] },
  { occ: "建筑工", tags: ["migrant"], wp: "construction", prestige: [30, 48], income: [3500, 5500] },
  { occ: "务农", tags: ["neighbor"], wp: "farm", prestige: [35, 55], income: [2000, 3500] },
  { occ: "小卖部老板", tags: ["merchant", "host"], wp: "shop", prestige: [40, 62], income: [4000, 7000] },
  { occ: "教师", tags: ["educated"], wp: "school", prestige: [50, 70], income: [4500, 6500] },
  { occ: "医生", tags: ["professional"], wp: "clinic", prestige: [55, 75], income: [5000, 8000] },
  { occ: "司机", tags: ["neighbor"], wp: "transport", prestige: [35, 50], income: [3500, 5000] },
  { occ: "裁缝", tags: ["crafts"], wp: "home", prestige: [35, 52], income: [2800, 4200] },
  { occ: "厨师", tags: ["service"], wp: "canteen", prestige: [32, 50], income: [3000, 4800] },
  { occ: "电工", tags: ["crafts"], wp: "utility", prestige: [38, 55], income: [3600, 5200] },
  { occ: "会计", tags: ["educated", "public_service"], wp: "village_committee", prestige: [48, 65], income: [4200, 6000] },
  { occ: "养殖户", tags: ["merchant"], wp: "farm", prestige: [40, 60], income: [3800, 6500] },
  { occ: "退休干部", tags: ["authority", "elder"], wp: "home", prestige: [60, 80], income: [3500, 5000] },
  { occ: "保姆", tags: ["service"], wp: "home", prestige: [28, 42], income: [2200, 3500] },
];

const EDUCATIONS = ["小学", "初中", "高中", "中专", "大专"];

const SOCIAL_SUBTYPES: Array<{
  key: string;
  label: string;
  summary: string;
  location: EventTemplate["locationType"];
  effects: Record<string, number>;
  dialogueForced: boolean;
}> = [
  { key: "visit_home", label: "串门", summary: "{{initiator.name}}去{{partner.name}}家串门闲聊", location: "home", effects: { moodDelta: 0.05, stressDelta: -0.03, affectionDelta: 2, intimacyDelta: 1.5, trustDelta: 1 }, dialogueForced: false },
  { key: "casual_chat", label: "闲谈", summary: "{{initiator.name}}与{{partner.name}}路边闲谈", location: "community", effects: { moodDelta: 0.03, affectionDelta: 1.2, intimacyDelta: 0.8, trustDelta: 0.6 }, dialogueForced: false },
  { key: "tea_chat", label: "喝茶", summary: "{{initiator.name}}请{{partner.name}}喝茶叙旧", location: "venue", effects: { moodDelta: 0.06, stressDelta: -0.04, affectionDelta: 2.2, intimacyDelta: 1.8, trustDelta: 1.2 }, dialogueForced: false },
  { key: "help_chore", label: "帮忙", summary: "{{initiator.name}}帮{{partner.name}}干农活/家务", location: "home", effects: { moodDelta: 0.04, affectionDelta: 2.5, trustDelta: 2, intimacyDelta: 1.5 }, dialogueForced: false },
  { key: "share_meal", label: "吃饭", summary: "{{initiator.name}}与{{partner.name}}一起吃饭", location: "home", effects: { moodDelta: 0.07, affectionDelta: 2.8, intimacyDelta: 2, trustDelta: 1.5, energyDelta: 0.03 }, dialogueForced: false },
  { key: "gossip", label: "闲话", summary: "{{initiator.name}}与{{partner.name}}聊村里闲话", location: "community", effects: { moodDelta: 0.02, arousalDelta: 0.04, affectionDelta: 0.8, intimacyDelta: 1, trustDelta: -0.3 }, dialogueForced: false },
  { key: "comfort", label: "安慰", summary: "{{initiator.name}}安慰情绪低落的{{partner.name}}", location: "home", effects: { moodDelta: 0.08, stressDelta: -0.08, affectionDelta: 3, trustDelta: 2, intimacyDelta: 2 }, dialogueForced: false },
  { key: "quarrel", label: "争执", summary: "{{initiator.name}}与{{partner.name}}发生争执", location: "community", effects: { moodDelta: -0.08, stressDelta: 0.1, affectionDelta: -3, trustDelta: -2, intimacyDelta: -0.5, arousalDelta: 0.1 }, dialogueForced: false },
  { key: "borrow_tool", label: "借东西", summary: "{{initiator.name}}向{{partner.name}}借工具/物资", location: "home", effects: { affectionDelta: 0.5, trustDelta: 1.5, intimacyDelta: 0.8 }, dialogueForced: false },
  { key: "walk_together", label: "散步", summary: "{{initiator.name}}约{{partner.name}}散步聊天", location: "community", effects: { moodDelta: 0.05, energyDelta: -0.02, affectionDelta: 1.5, intimacyDelta: 1.2, stressDelta: -0.04 }, dialogueForced: false },
  { key: "market_bump", label: "集市偶遇", summary: "{{initiator.name}}在集市偶遇{{partner.name}}", location: "community", effects: { moodDelta: 0.03, affectionDelta: 1, intimacyDelta: 0.6 }, dialogueForced: false },
  { key: "ask_favor", label: "托人办事", summary: "{{initiator.name}}拜托{{partner.name}}帮忙办事", location: "abstract", effects: { affectionDelta: 0.5, trustDelta: 1, intimacyDelta: 0.5 }, dialogueForced: false },
  { key: "card_game", label: "打牌", summary: "{{initiator.name}}与{{partner.name}}打牌娱乐", location: "venue", effects: { moodDelta: 0.04, arousalDelta: 0.05, affectionDelta: 1.5, intimacyDelta: 1.5, energyDelta: -0.04 }, dialogueForced: false },
  { key: "childcare_help", label: "看孩子", summary: "{{initiator.name}}帮{{partner.name}}照看孩子", location: "home", effects: { affectionDelta: 2.5, trustDelta: 2.2, intimacyDelta: 2 }, dialogueForced: false },
  { key: "festival_greet", label: "节庆问候", summary: "{{initiator.name}}向{{partner.name}}拜年/节庆问候", location: "home", effects: { moodDelta: 0.06, affectionDelta: 2, intimacyDelta: 1.5, trustDelta: 1 }, dialogueForced: false },
  { key: "workplace_chat", label: "工地闲聊", summary: "{{initiator.name}}与{{partner.name}}在工作间隙闲聊", location: "workplace", effects: { moodDelta: 0.02, affectionDelta: 1, intimacyDelta: 0.7, trustDelta: 0.8 }, dialogueForced: false },
  { key: "apology", label: "道歉和解", summary: "{{initiator.name}}向{{partner.name}}道歉和解", location: "home", effects: { moodDelta: 0.04, stressDelta: -0.05, affectionDelta: 2, trustDelta: 2.5, intimacyDelta: 1 }, dialogueForced: false },
  { key: "introduce", label: "介绍认识", summary: "{{initiator.name}}把{{partner.name}}介绍给熟人圈子", location: "community", effects: { affectionDelta: 1.2, intimacyDelta: 1, trustDelta: 1 }, dialogueForced: false },
  { key: "night_visit", label: "晚间串门", summary: "{{initiator.name}}晚间去{{partner.name}}家坐坐", location: "home", effects: { moodDelta: 0.05, affectionDelta: 2.2, intimacyDelta: 2, trustDelta: 1.2, energyDelta: -0.03 }, dialogueForced: false },
  { key: "rain_shelter", label: "避雨闲聊", summary: "{{initiator.name}}与{{partner.name}}躲雨时闲聊", location: "community", effects: { moodDelta: 0.03, affectionDelta: 1.3, intimacyDelta: 1 }, dialogueForced: false },
];

const PUBLIC_KINDS: Array<{
  key: string;
  label: string;
  summary: string;
  mode: "host" | "dialogue" | "random";
  tags?: string;
}> = [
  { key: "road_maintenance", label: "道路养护", summary: "{{initiator.name}}组织道路养护动员", mode: "host", tags: "community_leader" },
  { key: "health_campaign", label: "卫生宣传", summary: "{{initiator.name}}开展卫生健康宣传", mode: "host", tags: "community_leader" },
  { key: "conflict_mediation", label: "邻里调解", summary: "{{initiator.name}}主持邻里纠纷调解", mode: "host", tags: "authority" },
  { key: "festival_prep", label: "节庆筹备", summary: "{{initiator.name}}召集节庆筹备会", mode: "host", tags: "host" },
  { key: "school_meeting", label: "家长会", summary: "{{initiator.name}}召开学校家长会", mode: "host", tags: "educated" },
  { key: "market_fair", label: "集市管理", summary: "{{initiator.name}}协调集市摊位与秩序", mode: "random", tags: "merchant" },
  { key: "disaster_drill", label: "防灾演练", summary: "{{initiator.name}}组织防灾演练", mode: "host", tags: "community_leader" },
  { key: "elder_care", label: "敬老活动", summary: "{{initiator.name}}发起敬老慰问活动", mode: "dialogue", tags: "elder" },
  { key: "irrigation", label: "灌溉协调", summary: "{{initiator.name}}协调灌溉用水安排", mode: "host", tags: "neighbor" },
  { key: "clinic_day", label: "义诊日", summary: "{{initiator.name}}组织义诊与健康咨询", mode: "host", tags: "professional" },
  { key: "election_brief", label: "村务通报", summary: "{{initiator.name}}通报村务公开事项", mode: "host", tags: "authority" },
  { key: "youth_sports", label: "青年文体", summary: "{{initiator.name}}组织青年文体活动", mode: "random" },
  { key: "waste_cleanup", label: "环境整治", summary: "{{initiator.name}}发动环境清洁日", mode: "host", tags: "community_leader" },
  { key: "loan_coop", label: "互助金说明", summary: "{{initiator.name}}说明互助金规则", mode: "host", tags: "public_service" },
  { key: "wedding_help", label: "帮忙办喜事", summary: "{{initiator.name}}号召邻里帮忙办喜事", mode: "dialogue", tags: "host" },
  { key: "funeral_help", label: "白事协助", summary: "{{initiator.name}}协调白事礼仪协助", mode: "host", tags: "elder" },
  { key: "skill_share", label: "技能分享", summary: "{{initiator.name}}组织职业技能分享", mode: "dialogue", tags: "crafts" },
  { key: "security_patrol", label: "夜间巡逻", summary: "{{initiator.name}}安排夜间巡逻分工", mode: "host", tags: "authority" },
  { key: "temple_fair", label: "庙会筹备", summary: "{{initiator.name}}筹备庙会摊位与演出", mode: "host", tags: "host" },
  { key: "land_dispute", label: "地界协商", summary: "{{initiator.name}}主持地界协商会", mode: "host", tags: "authority" },
  { key: "coop_buy", label: "团购农资", summary: "{{initiator.name}}组织农资团购", mode: "random", tags: "merchant" },
  { key: "broadcast", label: "广播通知", summary: "{{initiator.name}}通过广播发布公共通知", mode: "random", tags: "public_service" },
  { key: "volunteer", label: "志愿活动", summary: "{{initiator.name}}招募志愿者服务", mode: "dialogue" },
  { key: "library_day", label: "农家书屋", summary: "{{initiator.name}}开放农家书屋活动日", mode: "random", tags: "educated" },
  { key: "power_outage", label: "停电协商", summary: "{{initiator.name}}协商临时停电安排", mode: "host", tags: "crafts" },
];

function makeSocialTemplate(i: number, rng: () => number): EventTemplate {
  const base = SOCIAL_SUBTYPES[i % SOCIAL_SUBTYPES.length]!;
  const variant = Math.floor(i / SOCIAL_SUBTYPES.length);
  const id = `random.social_${base.key}_${String(i + 1).padStart(3, "0")}`;
  const scale = 0.7 + (variant % 5) * 0.1 + rng() * 0.05;
  const effects = Object.fromEntries(
    Object.entries(base.effects).map(([k, v]) => [k, round1(v * scale)]),
  );
  const slots: EventTemplate["roleSlots"] = [
    {
      slotId: "initiator",
      label: "发起人",
      cardinality: 1,
      required: true,
      resolver: { type: "self" },
      occupancy: "required",
    },
    {
      slotId: "partner",
      label: "对象",
      cardinality: 1,
      required: true,
      resolver: { type: "relationship", ofSlot: "initiator", metric: "affection", topK: 8 },
      occupancy: "required",
    },
  ];
  return {
    templateId: id,
    category: "private",
    subType: `social_${base.key}`,
    visibility: "private",
    trigger: { method: "agent_driven" },
    roleSlots: slots,
    goalTemplates: [
      {
        goalTemplateId: "attend_init",
        assignedToSlot: "initiator",
        goalType: "attend",
        params: {},
        priority: 40,
        optional: false,
        descriptionTemplate: `参与${base.label}`,
      },
      {
        goalTemplateId: "attend_partner",
        assignedToSlot: "partner",
        goalType: "attend",
        params: {},
        priority: 40,
        optional: false,
        descriptionTemplate: `参与${base.label}`,
      },
    ],
    dialogue: {
      mode: "dialogue",
      minParticipants: 2,
      maxParticipants: 2,
      maxTurns: 4,
      forced: base.dialogueForced,
    },
    locationType: base.location,
    durationSlots: 1,
    contentSummaryTemplate: base.summary,
    params: {
      randomSocial: true,
      socialLabel: base.label,
      socialEffects: effects,
      variant,
    },
    basePriority: 30 + (variant % 10),
  };
}

function makePublicTemplate(i: number, rng: () => number): EventTemplate {
  const base = PUBLIC_KINDS[i % PUBLIC_KINDS.length]!;
  const variant = Math.floor(i / PUBLIC_KINDS.length);
  const id = `public.catalog_${base.key}_${String(i + 1).padStart(3, "0")}`;
  const p = round1(0.01 + (variant % 8) * 0.005 + rng() * 0.004);
  const donate = 50 + (variant % 10) * 20 + randInt(rng, 0, 40);
  const initiatorResolver = base.tags
    ? ({ type: "tag_match" as const, tag: base.tags, count: 1 })
    : ({ type: "random_adult" as const, minAge: 25 });
  return {
    templateId: id,
    category: "public",
    subType: base.key,
    visibility: "public",
    trigger: {
      method: "scheduled",
      schedule: {
        probabilityPerSlot: p,
        validSlots: variant % 2 === 0 ? ["AM"] : ["AM", "PM"],
      },
    },
    roleSlots: [
      {
        slotId: "initiator",
        label: base.label + "发起人",
        cardinality: 1,
        required: true,
        resolver: initiatorResolver,
        occupancy: "required",
      },
      {
        slotId: "residents",
        label: "参与居民",
        cardinality: { min: 2, max: 6 },
        required: true,
        resolver: { type: "same_community" },
        occupancy: "optional",
      },
    ],
    goalTemplates: [
      {
        goalTemplateId: "attend",
        assignedToSlot: "residents",
        goalType: "attend",
        params: {},
        priority: 50,
        optional: false,
        descriptionTemplate: `参加${base.label}`,
      },
      {
        goalTemplateId: "donate",
        assignedToSlot: "residents",
        goalType: "donate_cash",
        params: { amount: donate },
        priority: 45,
        optional: true,
        descriptionTemplate: `为${base.label}捐款`,
      },
    ],
    dialogue: {
      mode: base.mode,
      minParticipants: 2,
      maxParticipants: 6,
      maxTurns: 6,
      forced: variant % 4 === 0,
    },
    locationType: "community",
    durationSlots: 1,
    contentSummaryTemplate: base.summary,
    params: { catalogVariant: variant, occasion: base.key },
    basePriority: 45 + (variant % 15),
  };
}

function generateAgents(n: number, rng: () => number) {
  const agents = [];
  const familyCount = Math.ceil(n / 4);
  const families: string[][] = Array.from({ length: familyCount }, () => []);

  for (let i = 0; i < n; i++) {
    const id = `a${String(i + 1).padStart(3, "0")}`;
    const gender = rng() < 0.52 ? "M" : "F";
    const surname = pick(rng, SURNAMES);
    const given = pick(rng, gender === "M" ? GIVEN_M : GIVEN_F);
    const occSpec = pick(rng, OCCUPATIONS);
    const prestige = randInt(rng, occSpec.prestige[0], occSpec.prestige[1]);
    const income = randInt(rng, occSpec.income[0], occSpec.income[1]);
    const face = Math.max(20, Math.min(90, prestige + randInt(rng, -8, 8)));
    const fam = i % familyCount;
    families[fam]!.push(id);

    // Ensure leaders exist
    const forceLeader = i < 3;
    const tags = forceLeader
      ? ["host", "authority", "community_leader"]
      : [...occSpec.tags];
    const occupation = forceLeader
      ? (i === 0 ? "村委会主任" : i === 1 ? "村委会文书" : "退休干部")
      : occSpec.occ;

    agents.push({
      public: {
        id,
        name: `${surname}${given}`,
        age: randInt(rng, 22, 78),
        gender,
        occupation,
        education: pick(rng, EDUCATIONS),
        kinship: [] as string[],
        socialTags: tags,
        face: forceLeader ? 70 + i * 3 : face,
        prestige: forceLeader ? 72 + i * 4 : prestige,
        reputation: forceLeader ? 68 + i * 2 : Math.round((face + prestige) / 2),
        communityId: "village",
        workplaceId: forceLeader ? "village_committee" : occSpec.wp,
        hobbies: [pick(rng, ["下棋", "打牌", "看电视", "散步", "种菜", "戏曲"])],
        habits: [pick(rng, ["早起", "爱抽烟", "节俭", "爱请客", "少言"])],
      },
      private: {
        bigFive: {
          O: round1(0.2 + rng() * 0.6),
          C: round1(0.2 + rng() * 0.6),
          E: round1(0.15 + rng() * 0.7),
          A: round1(0.2 + rng() * 0.65),
          N: round1(0.1 + rng() * 0.6),
        },
        emotion: {
          mood: round1(0.35 + rng() * 0.4),
          arousal: round1(0.2 + rng() * 0.4),
          stress: round1(0.1 + rng() * 0.45),
          energy: round1(0.4 + rng() * 0.45),
        },
      },
      economy: {
        cash: randInt(rng, 800, 12000),
        deposit: randInt(rng, 1000, 80000),
        debt: rng() < 0.25 ? randInt(rng, 500, 8000) : 0,
        creditLimit: randInt(rng, 2000, 25000),
        income: forceLeader ? 6000 + i * 400 : income,
        essentialExpenseRatio: round1(0.35 + rng() * 0.25),
        savingsRatio: round1(0.1 + rng() * 0.2),
      },
    });
  }

  // Fill kinship within families
  for (const fam of families) {
    for (const id of fam) {
      const agent = agents.find((a) => a.public.id === id)!;
      agent.public.kinship = fam.filter((x) => x !== id);
    }
  }

  // Deduplicate names lightly
  const seen = new Set<string>();
  for (const a of agents) {
    let name = a.public.name;
    let k = 1;
    while (seen.has(name)) {
      name = `${a.public.name}${k++}`;
    }
    a.public.name = name;
    seen.add(name);
  }

  return { agents, families };
}

function addEdge(
  edges: RelationshipEdge[],
  from: string,
  to: string,
  socialBasis: SocialBasis,
  relationAxis: RelationAxis,
  rng: () => number,
  boost = 0,
): void {
  if (from === to) return;
  if (edges.some((e) => e.from === from && e.to === to)) return;
  edges.push({
    from,
    to,
    socialBasis,
    intimacy: round1(25 + rng() * 45 + boost),
    trust: round1(25 + rng() * 45 + boost),
    affection: round1(20 + rng() * 50 + boost),
    authority: round1(rng() * 40 + (relationAxis === "vertical_up" ? 30 : 10)),
    giftDebt: 0,
    reciprocityScore: round1(0.3 + rng() * 0.4),
    relationAxis,
  });
}

function generateRelationships(
  agentIds: string[],
  families: string[][],
  agents: Array<{ public: { id: string; prestige?: number; workplaceId?: string } }>,
  rng: () => number,
): RelationshipEdge[] {
  const edges: RelationshipEdge[] = [];
  const byId = new Map(agents.map((a) => [a.public.id, a]));

  // Family ties
  for (const fam of families) {
    for (const a of fam) {
      for (const b of fam) {
        if (a >= b) continue;
        const pa = byId.get(a)?.public.prestige ?? 50;
        const pb = byId.get(b)?.public.prestige ?? 50;
        if (pa >= pb + 8) {
          addEdge(edges, a, b, "kin", "vertical_down", rng, 25);
          addEdge(edges, b, a, "kin", "vertical_up", rng, 25);
        } else if (pb >= pa + 8) {
          addEdge(edges, b, a, "kin", "vertical_down", rng, 25);
          addEdge(edges, a, b, "kin", "vertical_up", rng, 25);
        } else {
          addEdge(edges, a, b, "kin", "horizontal", rng, 25);
          addEdge(edges, b, a, "kin", "horizontal", rng, 25);
        }
      }
    }
  }

  // Workplace / neighbor / friend random edges
  for (const id of agentIds) {
    const self = byId.get(id)!;
    const others = agentIds.filter((x) => x !== id);
    // Prefer same workplace
    const sameWp = others.filter(
      (x) => byId.get(x)?.public.workplaceId === self.public.workplaceId,
    );
    const pool = [...sameWp, ...others];
    const degree = randInt(rng, 4, 10);
    for (let k = 0; k < degree; k++) {
      const to = pool[Math.floor(rng() * pool.length)]!;
      const basis: SocialBasis =
        sameWp.includes(to) && rng() < 0.6
          ? "colleague"
          : rng() < 0.35
            ? "friend"
            : "neighbor";
      const otherP = byId.get(to)?.public.prestige ?? 50;
      const selfP = self.public.prestige ?? 50;
      let axis: RelationAxis = "horizontal";
      if (otherP >= selfP + 12) axis = "vertical_up";
      else if (selfP >= otherP + 12) axis = "vertical_down";
      addEdge(edges, id, to, basis, axis, rng, basis === "friend" ? 10 : 0);
      // Reciprocal soft edge
      if (rng() < 0.85) {
        const revAxis: RelationAxis =
          axis === "vertical_up" ? "vertical_down" : axis === "vertical_down" ? "vertical_up" : "horizontal";
        addEdge(edges, to, id, basis, revAxis, rng, basis === "friend" ? 10 : 0);
      }
    }
  }

  return edges;
}

function main(): void {
  const rng = mulberry32(20260724);
  const { agents, families } = generateAgents(100, rng);
  const agentIds = agents.map((a) => a.public.id);
  const relationships = generateRelationships(agentIds, families, agents, rng);

  const publicTemplates: EventTemplate[] = [];
  for (let i = 0; i < 500; i++) publicTemplates.push(makePublicTemplate(i, rng));
  const randomTemplates: EventTemplate[] = [];
  for (let i = 0; i < 500; i++) randomTemplates.push(makeSocialTemplate(i, rng));

  mkdirSync(join(dataDir, "event_catalogs"), { recursive: true });
  writeFileSync(
    join(dataDir, "agents_100.json"),
    JSON.stringify({ agents }, null, 2),
    "utf8",
  );
  writeFileSync(
    join(dataDir, "relationships_100.json"),
    JSON.stringify({ relationships }, null, 2),
    "utf8",
  );
  writeFileSync(
    join(dataDir, "event_catalogs", "public_500.json"),
    JSON.stringify({ templates: publicTemplates }, null, 2),
    "utf8",
  );
  writeFileSync(
    join(dataDir, "event_catalogs", "random_500.json"),
    JSON.stringify({ templates: randomTemplates }, null, 2),
    "utf8",
  );

  console.log(`Generated agents_100.json (${agents.length} agents)`);
  console.log(`Generated relationships_100.json (${relationships.length} edges)`);
  console.log(`Generated public_500.json (${publicTemplates.length})`);
  console.log(`Generated random_500.json (${randomTemplates.length})`);
}

main();
