# 礼物的流动 — 7 日极简冲刺板（2 人）

> **完整项目计划板（延长版 / Phase 0–6）请看 → [`project-plan-board.md`](./project-plan-board.md)**  
> 本文件为早期 7 日裁剪备忘；后续排期与验收以完整板 Phase ID 为准。  
> 
> 选型锚点：阎云翔《礼物的流动》A 档机制  
> 工时（极简）：2 人 × 7 天 ≈ 14 人日  
> 验收主线：`送礼 → 回礼/违约 → 关系变化 → JSONL 可回放 → 对照指标`  
> 详细规格见仓库 `reference/plan.md`、`reference/simulation-development-plan.md`

**角色约定**

| 代号    | 侧重点                           |
| ----- | ----------------------------- |
| **A** | 仿真内核：时钟、事务、规则、经济/礼物、对话接入      |
| **B** | 契约与演示：日志/快照、Replay、前端、实验脚本与指标 |

**状态标记**：`[ ]` 待做 · `[~]` 进行中 · `[x]` 完成 · `[-]` 本轮砍掉

---

## 总原则（每天开工前对一下）

1. LLM 只出文本/意图提案，**不写**信任、现金、礼单状态。
2. 状态变更 100% 经 RuleEngine，并写 append-only 日志（含 `before/after/reason`）。
3. 功能取舍标准：能否服务 **礼物—人情债—关系网络可回放**；接不上就砍或 mock。
4. **D1 冻结**：`LogEntry.type`、`WorldSnapshot`、`RelationshipEdge`、`GiftRecord` 字段名不再随意改。

---

## Day 1 — 契约与空跑

| ID    | 任务                                                       | 负责人 | 产出 / 验收                        | 状态  |
| ----- | -------------------------------------------------------- | --- | ------------------------------ | --- |
| D1-A1 | 补齐 `shared/types`：`SimTime`、Agent、Edge、Gift、Log、Snapshot | A   | types 可被 backend 引用编译          | [x] |
| D1-A2 | `TimeScheduler`：day × AM/PM/EVE 空循环                      | A   | 可跑 N slots（默认 30）              | [x] |
| D1-A3 | `RuleEngine` 空壳 + `commit` 接口约定                          | A   | 非法提案返回 rejected 并记日志           | [x] |
| D1-B1 | `LogWriter`（JSONL）+ `SnapshotStore`                      | B   | 每 slot 写出 start/end + snapshot | [x] |
| D1-B2 | `agents.json` 初始 8–12 人（含 kinship / 职业 / 现金）             | B   | 可加载进 PersonState               | [x] |
| D1-B3 | 空跑入口 `npm run sim:empty`                                 | B   | 一键空跑并在 `data/runs/` 落盘         | [x] |
| D1-AB | **接口冻结会议**（30min）：事件 type 枚举 + snapshot schema           | AB  | 写入本文件附录「冻结 Schema」             | [x] |

**日终 Definition of Done**：空实验跑完，磁盘上有 JSONL + 至少 1 份 snapshot。 — **已通过 `npm run verify:d1`**

```bash
npm run sim:empty     # 默认 30 slots
npm run verify:d1     # 一键验收
```

---

## Day 2 — 关系 · 经济 · 礼单

| ID    | 任务                                                    | 负责人 | 产出 / 验收                       | 状态  |
| ----- | ----------------------------------------------------- | --- | ----------------------------- | --- |
| D2-A1 | `RelationshipGraph` 双向有向边 CRUD                        | A   | 可查 ego 社交圈                    | [x] |
| D2-A2 | 关系字段：`giftDebt` / `reciprocityScore` / `relationAxis` | A   | 与阎云翔横向/纵向对齐                   | [x] |
| D2-A3 | `EconomyManager`：cash + 月初结算公式                        | A   | 单元级验算通过                       | [x] |
| D2-A4 | `GiftLedgerManager`：CRUD + 回礼窗口状态机                    | A   | pending → replied / defaulted | [x] |
| D2-B1 | ReplayEngine v0：`seekTo(simTime)` / `seekToSeq`       | B   | 加载最近 snapshot + 增量 log        | [x] |
| D2-B2 | 前端壳：时间轴列表（静态假数据可）                                     | B   | 本地打开能翻 slot                   | [x] |
| D2-B3 | 假数据对接：用脚本伪造 3 条 gift + delta 测回放                      | B   | seek 后关系/礼单可见                 | [x] |

**日终 DoD**：纯规则路径可写入「送礼→关系涨」日志（可不接 LLM）。 — **已通过 `npm run verify:d2`**

```bash
npm run sim:seed-gifts     # 规则路径注入 3 次送礼 + 违约/回礼
npm run frontend:export    # 导出 demo_data.json
npm run frontend:serve     # http://127.0.0.1:5177/
npm run verify:d2          # 一键验收
```

---

## Day 3 — 事务闭环打通礼物

| ID    | 任务                                                    | 负责人 | 产出 / 验收              | 状态  |
| ----- | ----------------------------------------------------- | --- | -------------------- | --- |
| D3-A1 | EventTemplate：`ritual_gift` / `repay_gift`（+1 私人模板可选） | A   | JSON 可加载             | [ ] |
| D3-A2 | EventGenerator：仅 `manual` + `scheduled`               | A   | 关掉 agent_driven      | [ ] |
| D3-A3 | EventScheduler：排队处理 + occupancy 冲突拒绝                  | A   | 拒绝写 `event.rejected` | [ ] |
| D3-A4 | 礼物全流程入 pipeline：意图→扣现金→写礼单→改关系→写回礼 Intention（可简写）     | A   | 日志可追踪                | [ ] |
| D3-B1 | PET 极简版（知情时间 / 来源 / confidence）                       | B   | 事务传播写 PET            | [ ] |
| D3-B2 | 前端接真 snapshot：Agent inspector + 礼单列表                  | B   | 选 agent 看边与债         | [ ] |
| D3-B3 | 关系图画布（力导向或静态表均可）                                      | B   | 边粗细映 intimacy/trust  | [ ] |

**日终 DoD**：无对话也可跑「主办仪式→客人送礼→窗口检查→违约」。

---

## Day 4 — 薄对话接入

| ID    | 任务                                                     | 负责人 | 产出 / 验收                | 状态  |
| ----- | ------------------------------------------------------ | --- | ---------------------- | --- |
| D4-A1 | `DialogPromptBuilder`：Self 公私 + Other 公开 + Edge + 礼债摘要 | A   | prompt 结构稳定可测          | [ ] |
| D4-A2 | `DialogueController`：仅双人 dialogue，4–6 轮                | A   | 礼事务强制短对话               | [ ] |
| D4-A3 | LLM adapter 接口 + mock / 真模型可切换                         | A   | 无 key 时用 mock 不堵流水线    | [ ] |
| D4-A4 | 对话情感分 → RuleEngine clamp → RelationshipUpdater         | A   | delta 带 formula/reason | [ ] |
| D4-B1 | 日志类型补齐：`dialogue.*` / `relationship.delta` / `gift.*`  | B   | 附录枚举全部出现               | [ ] |
| D4-B2 | `traceAgent` / `traceGift` API 或 CLI                   | B   | 按 id 过滤 JSONL          | [ ] |
| D4-B3 | Inspector 显示最近对话摘要                                     | B   | 与 log 一致               | [ ] |

**日终 DoD**：有/无 LLM 两条路径都能完成送礼闭环。

---

## Day 5 — 集成整槽 pipeline

| ID    | 任务                                                                | 负责人 | 产出 / 验收                  | 状态  |
| ----- | ----------------------------------------------------------------- | --- | ------------------------ | --- |
| D5-A1 | 单 slot 管线按计划串联（月初结算→生成→调度→giftWindowCheck→snapshot）               | A   | 与 `plan.md` §5 一致        | [ ] |
| D5-A2 | StyleProfile 极简（人格→语气，不改数值）                                       | A   | 可观察措辞差异即可                | [ ] |
| D5-A3 | 修边界：超额送礼拒绝、现金不足、窗口边界                                              | A   | 均有 rejected/defaulted 日志 | [ ] |
| D5-B1 | `npm run sim:run` 批跑 30–60 天                                      | B   | 一键落盘完整 run               | [ ] |
| D5-B2 | 指标导出：`reciprocity_rate` / `gift_default_rate` / `avg_repay_delay` | B   | CSV 或 JSON               | [ ] |
| D5-B3 | 前端：时间线 seek + 指标小面板                                               | B   | demo 路径 ≤3 步             | [ ] |

**日终 DoD**：一次完整 run + 可回放 + 导出三项指标。

---

## Day 6 — 对照实验

| ID    | 任务                                   | 负责人 | 产出 / 验收         | 状态  |
| ----- | ------------------------------------ | --- | --------------- | --- |
| D6-A1 | 实验开关：E2（有/无互惠规则 R2–R3）或 E1（有/无礼单记忆）  | A   | config 切换可复现    | [ ] |
| D6-A2 | 可选：纵向礼简易规则（`relationAxis` + 非对称回礼容差） | A   | 有余力再做；不够就记入「未做」 | [ ] |
| D6-A3 | 稳定性：固定 seed、mock LLM 确定性             | A   | 同 config 两次指标接近 | [ ] |
| D6-B1 | 跑对照两组并出对比表/图                         | B   | 汇报可直接贴          | [ ] |
| D6-B2 | 回放 demo 剧本（指定 day/slot 看违约）          | B   | 3–5 分钟可讲完       | [ ] |
| D6-B3 | 清理无效 run、写 `data/runs/README`        | B   | 保留 1 条金标准 run   | [ ] |

**日终 DoD**：至少 **一组对照** + 可叙述结果（支持/部分支持假设）。

---

## Day 7 — 缓冲 · Demo · 汇报

| ID    | 任务                      | 负责人 | 产出 / 验收     | 状态  |
| ----- | ----------------------- | --- | ----------- | --- |
| D7-A1 | Bug 清零（blocker only）    | A   | 金标准 run 不炸  | [ ] |
| D7-A2 | 架构一页图（LLM / Rule / Log） | A   | 贴进汇报        | [ ] |
| D7-B1 | 汇报稿：问题→阎云翔→模型→实验→局限     | B   | 诚实写「简化计算模型」 | [ ] |
| D7-B2 | Demo 彩排                 | AB  | 卡点有备用截图/录屏  | [ ] |
| D7-B3 | 本任务板全部状态回填              | AB  | 完成/砍掉一目了然   | [ ] |

---

## 本轮明确砍掉（不要临时加回来）

| 项                                            | 状态  |
| -------------------------------------------- | --- |
| AI-town Convex / 地图寻路 / Pixi 一体渲染            | [-] |
| 完整 AgentSociety PersonAgent ReAct            | [-] |
| agent_driven 事务生成                            | [-] |
| 认知树四层上呈（circle / social）                     | [-] |
| 完整 BDI/Emotion 驱动决策（Emotion 只进 StyleProfile） | [-] |
| Ostrom / 制度实体 / RL                           | [-] |
| 婚姻交换、政治等级、下岬村数字孪生                            | [-] |
| 主持人模式 / 随机发言模式（仅 dialogue）                   | [-] |

有余力再考虑（**不进 DoD**）：纵向礼指标、`prestige`/`face`、多 1 个公共事务模板、知识库 5 条礼俗。

---

## 每日站会（15 min）

1. 昨天完成的 ID  
2. 今天计划的 ID  
3. 是否冲击「冻结 Schema」或主验收链  
4. 需要另一方立刻提供的接口/假数据  

---

## 附录 A — 冻结 Schema（D1 已冻结，2026-07-15）

> **真源**：`sim/shared/types/index.ts`。字段名冻结后勿随意改；新增字段须双方同意并更新本附录。

### LogEventType（全集）

| type                                                                        | 何时写入                                   | D1    |
| --------------------------------------------------------------------------- | -------------------------------------- | ----- |
| `experiment.start` / `experiment.end`                                       | 实验边界                                   | ✅     |
| `timeslot.start` / `timeslot.end`                                           | 每 slot                                 | ✅     |
| `rule.rejected`                                                             | RuleEngine 拒绝提案（含 before/after/reason） | ✅     |
| `event.created` / `event.propagated` / `event.completed` / `event.rejected` | 事务系统                                   | D3    |
| `dialogue.start` / `dialogue.message` / `dialogue.end`                      | 对话                                     | D4    |
| `relationship.delta`                                                        | 关系公式变更                                 | D2+   |
| `gift.given` / `gift.replied` / `gift.defaulted`                            | 礼单                                     | D2–D3 |
| `economy.monthly`                                                           | 月初结算成功                                 | D2    |
| `bdi.updated`                                                               | Belief 同步（可选）                          | 后置    |
| ~~`cognitive.promoted`~~                                                    | 认知树上呈                                  | 本轮不做  |

### `SimTime`

```ts
{ day: number; slot: "AM" | "PM" | "EVE" }
```

### `RelationshipEdge`（双向有向，A→B 与 B→A 独立）

`from, to, socialBasis, intimacy, trust, affection, authority, giftDebt, reciprocityScore, relationAxis, lastChangedAt?, interactionSummary?`

`relationAxis`: `horizontal | vertical_up | vertical_down`

### `GiftRecord`

`gid, eid?, from, to, expressiveScore, instrumentalScore, value, adjustedValue, description, givenAt, replyWindowEnd, status, replyGid?, occasion?`

`status`: `pending_reply | replied | defaulted | closed`

### `WorldSnapshot`

`snapshotId, simTime, seq, agents, relationships, personalEventTables, giftLedger, eventQueue, metrics`

### `RuleProposal`（commit 入口）

`give_gift | repay_gift | relationship_delta | economy_monthly`

### 落盘约定

```
sim/data/runs/<runId>/
  config.json
  event_log.jsonl
  replay_index.json
  snapshots/D{day}-{slot}.json
```

---

## 附录 B — 主验收清单（Demo 当天勾）

- [ ] 能说明：送礼如何记账、回礼窗如何判定、违约如何降关系  
- [ ] 能打开一次 run 的回放，指到具体 `gift.defaulted`  
- [ ] 能展示至少一组对照的指标差  
- [ ] 能一句话划清：LLM vs RuleEngine  
- [ ] 能主动说局限：样本小、文化简化、非民族志复原  

---

## 附录 C — 与工程目录对照

| 任务域          | 代码位置                                                               |
| ------------ | ------------------------------------------------------------------ |
| 时钟 / 实验      | `sim/backend/engine/`                                              |
| 事务           | `sim/backend/systems/event/`                                       |
| 关系 / 经济 / 礼物 | `sim/backend/systems/{relationship,economy,gift}/`                 |
| 对话           | `sim/backend/systems/dialogue/` + `sim/backend/llm/`               |
| 规则           | `sim/backend/rules/`                                               |
| 日志回放         | `sim/backend/log/` + `sim/backend/store/` + `sim/frontend/replay/` |
| 配置数据         | `sim/data/`                                                        |
| 共享类型         | `sim/shared/types/`                                                |
