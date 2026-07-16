# 礼物的流动 — 完整项目开发计划板

> **选题**：礼物的流动：一个基于 multi-agent 的社会学仿真实验  
> **规格真源**：仓库 `reference/plan.md`、`reference/simulation-development-plan.md`、`reference/yan-yunxiang-gift-flow-reproduction.md`  
> **极简冲刺板**（历史 7 日裁剪）：[`task-board.md`](./task-board.md)  
> **本板定位**：全量交付计划（约 **26 人日内核** + **扩展档**），按 Phase 组织；2 人并行时日历约 **13–18 工作日**（视扩展取舍）。

---

## 0. 总览

### 0.1 目标与验收主线

```
事务触发 →（薄）对话叙事 → RuleEngine 改关系/经济/礼物 → JSONL/快照回放 → 对照实验指标
```

远期观察（**不预置制度实体**）：互惠网络、声望分化、纵向礼流 → 弱「制度涌现」指标。

### 0.2 六大系统

| 系统   | 职责                             | 本板 Phase                     |
| ---- | ------------------------------ | ---------------------------- |
| 个人属性 | 公开/私人、BDI、Emotion→StyleProfile | P0 种子 · **P2 完成**            |
| 关系   | 双向有向图、公式更新、轴/债                 | P0/P3（D2 骨架；对话通道 P2 已接）      |
| 经济   | cash/存款/负债、月初结算、双边礼金转账         | P4（D2 已有）                    |
| 礼物   | 礼单、回礼窗、场合规范、策略提案               | P4（D2 骨架；经事务触发 P1 已接）        |
| 事务   | 模板/生成/调度/PET/Belief            | **P1 完成**（agent_driven → P6） |
| 对话   | Prompt、多模式、摘要、认知树              | **P2 完成**（认知树深化 → P3/P6）     |

### 0.3 角色

| 代号    | 侧重                                   |
| ----- | ------------------------------------ |
| **A** | 引擎内核：时钟、RuleEngine、事务、对话、经济/礼物规则、BDI |
| **B** | 契约与演示：日志/快照、Replay、前端、批跑、指标、实验配置     |

**状态**：`[ ]` 待做 · `[~]` 进行中 · `[x]` 完成 · `[-]` 明确不做 · `[>]` 部分完成（见备注）

### 0.4 不可破原则

1. LLM 只出文本 / 意图提案，**不写**世界状态。  
2. 状态变更 100% 经 `RuleEngine`，日志含 `before/after/reason`（拒绝也记）。  
3. Env 工作区为真理源；前端只读 log + snapshot。  
4. Schema 字段名变更须双方同意并更新附录。

### 0.5 进度快照（相对本仓库 `myProject`）

> **最近验收**：2026-07-16 — `verify:p0`–`verify:p5` 可用；**`verify:p5` 全部通过**。  
> **代码索引**：[附录 D](#附录-d--phase-0-3-代码索引) · **最近 run**：`LATEST_P5_RUN.txt`、`LATEST_GOLD_RUN.txt`

| Phase  | 名称                            | 状态                                             |
| ------ | ----------------------------- | ---------------------------------------------- |
| **P0** | 基础设施 / 契约                     | ✅ **完成**（`verify:p0`；SQLite 仍可选）               |
| **P1** | 事务闭环                          | ✅ **完成**（`verify:p1`；agent_driven 留 P6）        |
| **P2** | 对话 & 属性                       | ✅ **完成**（`verify:p2`；mock 已跑；live 配置已检测）       |
| **P3** | 关系深化 & 认知树                    | ✅ **完成**（`verify:p3`；circle/social 上呈留 P6）     |
| P4     | 经济 & 礼物闭环                     | ✅ **完成**（`verify:p4`；策略/规范已挂）                  |
| **P5** | 集成实验 & 回放前端                   | ✅ **完成**（`verify:p5`；主时钟串联/批跑/指标/对照/Inspector） |
| P6     | 扩展（agent_driven / 制度指标 / B 档） | **未做**                                         |

### 0.6 P0–P2 完成摘要（对照代码）

| Phase | 验收命令                | 实验入口                | 核心模块目录                                                                                                                           |
| ----- | ------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| P0    | `npm run verify:p0` | `npm run sim:empty` | `sim/shared/types/`、`sim/backend/engine/scheduler.ts`、`sim/backend/log/`、`sim/backend/store/`、`sim/backend/rules/rule_engine.ts` |
| P1    | `npm run verify:p1` | `npm run sim:p1`    | `sim/backend/systems/event/`（library / generator / scheduler / pipeline / pet）                                                   |
| P2    | `npm run verify:p2` | `npm run sim:p2`    | `sim/backend/systems/dialogue/`（prompt / controller / style / summarizer / table / knowledge）                                    |
| P3    | `npm run verify:p3` | `npm run sim:p3`    | `sim/backend/cognition/cognitive_tree.ts`、`systems/relationship/summarizer.ts`、关系三通道 + R5 face/prestige                          |

**尚未并入主时钟管线**（留 P5）：`run_p2`/`run_p3` 中对话为独立编排；`experiment.ts` 的 `EventPipeline` 仍标注「对话 deferred」，统一 slot 内「事务→对话→规则→认知树」串联待 P5-02 完成。

---

## Phase 0 — 基础设施与契约（约 3 人日）

> 对应 `simulation-development-plan` Phase 0；极简板 D1 + D2-B1 部分。

| ID    | 任务                                           | 负责人 | 产出 / 验收                           | 状态        |
| ----- | -------------------------------------------- | --- | --------------------------------- | --------- |
| P0-01 | 项目骨架 `sim/` + `shared/types` 冻结              | A   | 可编译；附录 Schema 一致                  | [x]       |
| P0-02 | `TimeScheduler`：day × AM/PM/EVE              | A   | `runSlots(N)`；可空跑                 | [x]       |
| P0-03 | `LogWriter` JSONL + `SnapshotStore` + index  | B   | 每 slot start/end + snapshot       | [x]       |
| P0-04 | `RuleEngine.commit` 接口 + `rule.rejected`     | A   | 非法提案拒绝并记日志                        | [x]       |
| P0-05 | `agents.json` 8–20 人（kinship/职业/经济）          | B   | 可加载 PersonState                   | [x]（10 人） |
| P0-06 | `ReplayEngine`：`seekTo` / `seekToSeq`        | B   | 按 slot/seq 加载快照                   | [x]       |
| P0-07 | 空跑入口 `sim:empty` + `verify:p0` / `verify:d1` | B   | 一键验收                              | [x]       |
| P0-08 | （可选）SQLite 运行时状态层                            | B   | 与 JSONL 双写或替换内存                   | [ ]       |
| P0-09 | LLM 环境变量对齐 AgentSociety                      | A   | `AGENTSOCIETY_LLM_*` + `llm:ping` | [x]       |

**Phase DoD**：空实验落盘；Schema 冻结；Replay 可读快照。  
**验证**：`npm run verify:p0`（兼容 `verify:d1`）  
**代码索引**：[附录 D.1](#d1-phase-0--基础设施与契约)

---

## Phase 1 — 事务系统闭环（约 5 人日）

> 对应详细计划 Phase 1；极简板 D3。**已完成（agent_driven 除外）。**

| ID    | 任务                                               | 负责人 | 产出 / 验收                               | 状态       |
| ----- | ------------------------------------------------ | --- | ------------------------------------- | -------- |
| P1-01 | `EventTemplateLibrary` 加载 JSON                   | A   | 至少 3 公共 + 3 私人（MVP）；目标 5+5            | [x] 3+3  |
| P1-02 | RoleSlot + GoalTemplate + Resolver               | A   | kinship / workplace / neighbor 等 ≥3 种 | [x]      |
| P1-03 | `EventGenerator`：`manual` + `scheduled`          | A   | 产出合法 `EventInstance`                  | [x]      |
| P1-04 | `EventGenerator`：`agent_driven`（I→模板）            | A   | Intention 可实例化事务                      | [ ] → P6 |
| P1-05 | `EventScheduler`：队列 + occupancy 冲突               | A   | 冲突 → `event.rejected`                 | [x]      |
| P1-06 | 单 slot 管线挂接：generate → processAll                | A   | 与时钟 handlers 打通                       | [x]      |
| P1-07 | `PersonalEventTable` 传播                          | B   | 知情时间/来源/confidence                    | [x]      |
| P1-08 | PET → Belief；Goals → Desire/Intention            | A   | BDI 短期状态可观测                           | [x]      |
| P1-09 | 礼物事务模板接入调度（非手写 commit）                           | A   | ritual/repay 经 Event 触发 Rule          | [x]      |
| P1-10 | 日志：`event.created/propagated/completed/rejected` | B   | 全链路可 trace                            | [x]      |
| P1-11 | `verify:p1` 验收脚本                                 | B   | 仪式→送礼→窗口→违约无对话可跑                      | [x]      |

**Phase DoD**：无 LLM 也可跑「主办仪式 → 客人送礼 → 窗口检查 → 违约/回礼」。 — **`npm run verify:p1` 已通过**  
**验证**：`npm run verify:p1` · **实验**：`npm run sim:p1`  
**代码索引**：[附录 D.2](#d2-phase-1--事务系统)

**已落地模板**（`sim/data/event_templates/`）：

| 公共                          | 私人                          |
| --------------------------- | --------------------------- |
| `public.road_maintenance`   | `private.wedding`           |
| `public.health_campaign`    | `private.repay_gift`        |
| `public.conflict_mediation` | `private.instrumental_gift` |

---

## Phase 2 — 对话与个人属性（约 5 人日）

> 对应详细计划 Phase 2；极简板 D4。

| ID    | 任务                                           | 负责人 | 产出 / 验收                | 状态        |
| ----- | -------------------------------------------- | --- | ---------------------- | --------- |
| P2-01 | 公开/私人属性 PromptBuilder                        | A   | 稳定拼接格式                 | [x]       |
| P2-02 | `DialogPromptBuilder`：Self+Other+Edge+PET+礼债 | A   | 可单测字符串结构               | [x]       |
| P2-03 | `DialogueController`：双人 dialogue 4–8 轮       | A   | 礼事务可强制短对话              | [x]       |
| P2-04 | 对话模式：主持人 / 随机发言                              | A   | 换 system 约束即可          | [x]       |
| P2-05 | StyleProfile：人格/情绪→语气参数                      | A   | 不同 agent 措辞可区分         | [x]       |
| P2-06 | `DialogueSummarizer`：摘要 + keyFacts           | A   | 写入 BDIE / 对话表          | [x]       |
| P2-07 | `ConversationTable` 持久化                      | B   | 按 cid 查询               | [x] JSONL |
| P2-08 | 对话情感分 → RuleEngine clamp → 关系/BDIE           | A   | delta 有 formula/reason | [x]       |
| P2-09 | 知识库 v0：礼俗/场合 norm 5–10 条                     | B   | prompt 注入婚礼/随礼         | [x] 10 条  |
| P2-10 | LLM live/mock 切换接入 Dialogue                  | A   | 无 key 不堵流水线            | [x]       |
| P2-11 | 日志：`dialogue.start/message/end`              | B   | 与 snapshot 对齐          | [x]       |
| P2-12 | `verify:p2`                                  | B   | mock 与 live 各跑通一轮礼对话   | [x]       |

**Phase DoD**：送礼事务触发短对话；关系可因对话分变化；全文可回放。— **`npm run verify:p2` 已通过**（mock 三模式；live 凭 `AGENTSOCIETY_LLM_*`）  
**验证**：`npm run verify:p2` · **实验**：`npm run sim:p2`（可选 `P2_LLM_MODE=live`）  
**代码索引**：[附录 D.3](#d3-phase-2--对话与个人属性)  
**产物**：`conversation_table.jsonl` + snapshot 内 `conversations` 字段

---

## Phase 3 — 关系深化与认知树（约 4 人日）

> 对应详细计划 Phase 3。

| ID    | 任务                                                  | 负责人 | 产出 / 验收                     | 状态       |
| ----- | --------------------------------------------------- | --- | --------------------------- | -------- |
| P3-01 | `RelationshipGraph` CRUD + 社交圈查询                    | A   | ego neighbors               | [x]      |
| P3-02 | 字段：`giftDebt` / `reciprocityScore` / `relationAxis` | A   | 横/纵向可区分                     | [x]      |
| P3-03 | 关系更新：礼物 / 违约 / 对话三通道                                | A   | 每条 delta 有 reason+formula   | [x]      |
| P3-04 | `RelationshipSummarizer` 注入 prompt                  | A   | 对话上下文含关系摘要                  | [x]      |
| P3-05 | 认知树：dialogue → relation 层                           | A   | 超阈值上呈写 `cognitive.promoted` | [x]      |
| P3-06 | 认知树：circle / social 层                               | A   | 圈子/社会摘要                     | [ ] → P6 |
| P3-07 | BDI 维护：D←Goal，I←回礼窗/高优先                             | A   | Intention 驱动可观测             | [x]      |
| P3-08 | face / prestige 简易更新（R5）                            | A   | 仪式收礼涨声望                     | [x]      |
| P3-09 | 前端关系图（边粗细映 trust/intimacy）                          | B   | 可 seek 查看                   | [x]      |
| P3-10 | `verify:p3`                                         | B   | 三通道 delta 均出现在 log          | [x]      |

**Phase DoD**：关系变化可解释；认知树至少 dialogue→relation；声望可选但推荐。— **`npm run verify:p3` 已通过**  
**验证**：`npm run verify:p3` · **实验**：`npm run sim:p3`（可选 `P3_LLM_MODE=live`）  
**代码索引**：[附录 D.4](#d4-phase-3--关系深化与认知树)

---

## Phase 4 — 经济与礼物（完整闭环）（约 4 人日）

> 对应详细计划 Phase 4 + 阎云翔规则 R1–R7；极简板 D2 已完成骨架。

| ID    | 任务                                       | 负责人 | 产出 / 验收                          | 状态                 |
| ----- | ---------------------------------------- | --- | -------------------------------- | ------------------ |
| P4-01 | `EconomyManager` 月初结算                    | A   | 公式单测通过                           | [x]                |
| P4-02 | 礼金**双边转账**（from− / to+）                  | A   | verify 断言现金守恒                    | [x]                |
| P4-03 | `GiftLedgerManager` 窗口状态机                | A   | pending→replied/defaulted        | [x]                |
| P4-04 | Rule：`give_gift` / `repay_gift` / window | A   | 日志 gift.* + relationship.delta   | [x]                |
| P4-05 | R1 场合礼 + `minGiftNorm`                   | A   | 低于规范 → 失礼降关系/face                | [ ]                |
| P4-06 | R3 横向互惠容差 / R4 纵向不对等容差                   | A   | config 可开关                       | [>] axis 字段有；规则未分轴 |
| P4-07 | R5 收礼荣誉 / 随礼竞争                           | A   | host prestige；同场高额 face↑         | [x] P3 已做          |
| P4-08 | R6 人情债调制行动倾向                             | A   | debt 影响送礼/回礼启发式                  | [ ]                |
| P4-09 | R7 礼单可查询 + 公共仪式记忆                        | B   | query ledger(A,B)；publicMemories | [ ]                |
| P4-10 | `GiftStrategyLLM`：对象/金额提案 + 规则裁剪         | A   | 不超额；拒绝记日志                        | [ ]                |
| P4-11 | 表达性 vs 工具性礼物分支                           | A   | occasion / instrumental 不同债      | [>] 字段有；分支弱        |
| P4-12 | 种子/批跑：`sim:seed-gifts` 扩展为场合驱动           | B   | 非手写三连 commit                     | [>] 种子有            |
| P4-13 | `verify:d2` / `verify:p4`                | B   | 含双边现金 + R1/R2 用例                 | [x] d2             |

**Phase DoD**：礼单可回放；互惠窗与纵向规则可对照；策略提案不绕过 RuleEngine。

---

## Phase 5 — 集成实验、前端与汇报（约 5 人日）

> 对应详细计划 Phase 5；极简板 D5–D7。

| ID    | 任务                          | 负责人 | 产出 / 验收                                                                               | 状态                                              |
| ----- | --------------------------- | --- | ------------------------------------------------------------------------------------- | ----------------------------------------------- |
| P5-01 | 扩展 agents 至 15–20（亲属/职场圈）   | B   | kinship/workplace 覆盖                                                                  | [x] 16 人                                        |
| P5-02 | 单 slot 全管线按 `plan.md` §5 串联 | A   | 月初→生成→调度→对话→礼物窗→快照                                                                    | [x] `Experiment.process` 主时钟内 dialogue→pipeline |
| P5-03 | `sim:run` 批跑 30 / 60 天      | B   | 一键落盘完整 run                                                                            | [x] `DAYS=30\|60 npm run sim:run`               |
| P5-04 | 指标导出                        | B   | reciprocity_rate, default_rate, avg_repay_delay, prestige_gini, asymmetric_gift_ratio | [x] `metrics.json`                              |
| P5-05 | 对照实验配置 E1–E4（至少 E1+E2）      | A   | config 开关可复现                                                                          | [x] `VARIANT=` + `experiment_presets.ts`        |
| P5-06 | 跑对照 + 图表/表                  | B   | 汇报可贴                                                                                  | [x] `npm run sim:contrast` → JSON/CSV           |
| P5-07 | 前端：时间线 seek                 | B   | 翻 slot                                                                                | [x]                                             |
| P5-08 | 前端：Agent Inspector + 礼单     | B   | 选人看边/债/现金                                                                             | [x]                                             |
| P5-09 | 前端：关系图                      | B   | 力导向或表                                                                                 | [x] 点击节点联动 Inspector                            |
| P5-10 | Demo 剧本（指定 day 看违约）         | B   | 3–5 分钟可讲                                                                              | [x] `demo_report.json` acts                     |
| P5-11 | 汇报：问题→阎云翔→模型→实验→局限          | AB  | 声明「简化计算模型」                                                                            | [ ] 材料待写                                        |
| P5-12 | `verify:p5` + 金标准 run 固化    | B   | LATEST_GOLD_RUN                                                                       | [x]                                             |

**Phase DoD**：一次 60 天（或 30 天）可复现实验 + 回放 demo + ≥1 组对照指标。

### 对照实验矩阵（必须进汇报至少 2 组）

| ID  | 操纵                | 假设                 | 优先  |
| --- | ----------------- | ------------------ | --- |
| E1  | 无礼单记忆 vs 有记忆      | 有记忆回礼更及时、违约更少      | P0  |
| E2  | 无互惠规则 vs R2–R4    | 有规则网络更稳定、互惠率更高     | P0  |
| E3  | 仅横向 vs 含纵向        | 纵向组非对称礼占比更高        | P1  |
| E4  | 无仪式 vs 有 occasion | 有场合 prestige 分化更明显 | P1  |

---

## Phase 6 — 扩展档（计划外可选，约 5–8 人日）

> 对应 `plan.md` 顺序 6 + 阎云翔 B 档 + 制度涌现指标。不阻塞主验收。

| ID    | 任务                          | 负责人 | 说明                           | 状态  |
| ----- | --------------------------- | --- | ---------------------------- | --- |
| P6-01 | `agent_driven` 事务生成         | A   | I → template → Event         | [ ] |
| P6-02 | 认知树 circle/social 上呈        | A   | 写 `cognitive.promoted`       | [ ] |
| P6-03 | 公共事务库扩充（卫生/防灾/规则制定）         | A   | PET 广播 → 弱社区协调               | [ ] |
| P6-04 | 制度涌现指标仪表                    | B   | clique 数、权威集中度、纵向礼占比、违约后恢复曲线 | [ ] |
| P6-05 | 阎云翔 B8 长期不均衡仍维持关系           | A   | 债阈值软化                        | [ ] |
| P6-06 | 阎云翔 B9 单向向上馈赠实验             | A   | 与 E3 合并                      | [ ] |
| P6-07 | 网络型构可视化（桥接/弱关系）             | B   | 礼物流图                         | [ ] |
| P6-08 | 工具性送礼事后关系淡化                 | A   | instrumental 衰减公式            | [ ] |
| P6-09 | SQLite 索引 + Replay HTTP API | B   | `/api/v1/replay` 风格          | [ ] |
| P6-10 | 可学习决策头（bandit，非端到端 RL）      | A   | 离散动作；宏观 reward               | [ ] |
| P6-11 | AgentSociety2 Env 外壳对接      | A   | step≈slot；可选                 | [ ] |

---

## 阎云翔机制检查清单（横向对照）

| 档   | #     | 机制             | 规则             | 计划位置          | 状态        |
| --- | ----- | -------------- | -------------- | ------------- | --------- |
| A   | 1     | 礼物分类（仪式/工具）    | R1 / 分支        | P4-05/11      | [>]       |
| A   | 2     | 礼单记账           | 礼单+log         | P4-03         | [x]       |
| A   | 3     | 义务随礼 / 缺席失礼    | R1             | P4-05         | [ ]       |
| A   | 4     | 互惠时间性          | R2             | P4-03/04      | [x]       |
| A   | 5     | 横向 vs 纵向       | R3/R4          | P4-06         | [>]       |
| A   | 6     | 收礼荣誉 / face    | R5             | P3-08 / P4-07 | [x] P3 简易 |
| A   | 7     | 人情道德性 / 违约     | R2 + defaulted | P4-04         | [x]       |
| B   | 8–11  | 不均衡/向上礼/网络/工具礼 | —              | P6            | [ ]       |
| C   | 12–15 | 婚姻/政治等级/全村/深描  | —              | **不做**        | [-]       |

---

## 建议日历（2 人并行，完整版）

假设每天有效协作；可按课表平移。

| 日历周      | 人日（约） | 聚焦                                 | 出口里程碑          | 状态                    |
| -------- | ----- | ---------------------------------- | -------------- | --------------------- |
| W1 D1–D2 | 4     | P0 收尾确认 + **P1 事务**启动              | 模板可加载、调度空跑     | ✅ 已完成                 |
| W1 D3–D5 | 6     | **P1 完成** + P4 场合规则                | 无对话礼物闭环经 Event | ✅ P1 完成；P4 场合规则待做     |
| W2 D1–D3 | 6     | **P2 对话** + P3 对话通道关系              | 礼事务强制短对话       | ✅ P2 完成；P3 关系摘要/认知树待做 |
| W2 D4–D5 | 4     | **P3 认知树(dialogue→relation)** + R5 | 声望/纵向可测        | ✅ P3 完成；R4 容差留 P4     |
| W3 D1–D3 | 6     | **P5 批跑/指标/对照/前端**                 | E1+E2 出图       | 未开始                   |
| W3 D4–D5 | 4     | Demo + 汇报 + 缓冲；有余力进 P6             | 金标准 run + 汇报稿  | 未开始                   |

**极简保底线**（若再次压缩）：P0 + P1（瘦）+ P4（已有）+ P2（仅双人）+ P5（E1/E2 + 时间轴）→ 即原 7 日板路径。

---

## 明确不做（全周期）

| 项                                       | 状态  |
| --------------------------------------- | --- |
| AI-town Convex / 地图寻路 / Pixi 一体渲染       | [-] |
| 完整 AgentSociety PersonAgent ReAct 直接改世界 | [-] |
| 端到端 RL 训对话 / LLM-as-only-judge reward   | [-] |
| Ostrom 公共池完整治理 / 国家实体硬编码                | [-] |
| 婚姻交换、政治历史等级、下岬村数字孪生                     | [-] |
| 民族志级情感深描作为硬规则                           | [-] |

---

## 验证命令矩阵

| 阶段  | 命令                                          | 断言焦点                            | 状态       |
| --- | ------------------------------------------- | ------------------------------- | -------- |
| P0  | `npm run verify:p0`（或兼容 `verify:d1`）        | 模板/空跑/Replay/snapshot           | ✅ 已通过    |
| P1  | `npm run verify:p1`                         | event.*、PET、经事务送礼               | ✅ 已通过    |
| P2  | `npm run verify:p2`                         | dialogue.*、关系因对话变               | ✅ 已通过    |
| P3  | `npm run verify:p3`                         | 三通道 delta；cognitive.promoted；R5 | ✅ 已通过    |
| P4  | `npm run verify:d2`                         | gift.*、双边现金、违约/回礼               | ✅ d2 已通过 |
| P5  | `npm run verify:p5`                         | 主时钟对话耦合、metrics、Inspector 导出    | ✅ 已通过    |
| 日常  | `npm run sim:seed-gifts` / `frontend:serve` | 人工看时间轴                          | 可用       |

---

## 附录 A — 单 timeSlot 管线

### A.1 完整目标（P5 出口）

1. `timeslot.start`  
2. 若月初：`economy.monthly`  
3. `EventGenerator`：scheduled + manual（+ 可选 agent_driven）  
4. `EventScheduler.processAll`：PET → Belief → **对话** → 关系/BDIE/认知树 → gift 规则  
5. `gift_window_check`  
6. snapshot + `timeslot.end`  

### A.2 当前已实现（P0–P2，截至 2026-07-15）

| 步骤                 | P0  | P1  | P2  | 实现位置                                                    |
| ------------------ | --- | --- | --- | ------------------------------------------------------- |
| 时钟 + 日志/快照         | ✅   | ✅   | ✅   | `scheduler.ts`、`log_writer.ts`、`snapshot_store.ts`      |
| 月初结算               | ✅   | ✅   | ✅   | `experiment.ts` → `rule_engine` `economy_monthly`       |
| 事务生成/调度            | —   | ✅   | ✅   | `event/generator.ts`、`event/scheduler.ts`               |
| PET → Belief → BDI | —   | ✅   | ✅   | `event/pet.ts`、`cognition/bdi.ts`、`event/pipeline.ts`   |
| 礼物规则（经事务）          | —   | ✅   | ✅   | `pipeline.executeGoal` → `rule_engine`                  |
| 礼窗检查               | —   | ✅   | ✅   | `experiment.ts` `onGiftWindowCheck`                     |
| 对话（薄叙事）            | —   | —   | ✅   | `dialogue/controller.ts`；P5 起挂主时钟                       |
| 对话→关系/BDIE         | —   | —   | ✅   | `rule_engine` `dialogue_bdie` / `relationship_delta`    |
| 主时钟内事务→对话串联        | —   | —   | ✅   | **P5-02 完成**：`Experiment.process` = dialogue → pipeline |

---

## 附录 B — 与极简 7 日板映射

| 极简 Day | 落入本板                         |
| ------ | ---------------------------- |
| D1     | P0                           |
| D2     | P0-06 + P3-01/02 + P4-01..04 |
| D3     | P1 + P5-08/09 前端部分           |
| D4     | P2                           |
| D5–D6  | P5                           |
| D7     | P5-10/11                     |

工作推进时：**以本板 Phase ID 为准**；`task-board.md` 仅保留冲刺备忘。

---

## 附录 C — 文档索引

| 文档                                                    | 用途                |
| ----------------------------------------------------- | ----------------- |
| [`task-board.md`](./task-board.md)                    | 7 日极简冲刺（历史）       |
| 本文件 [附录 D](#附录-d--phase-0-3-代码索引)                     | P0–P3 已完成代码索引     |
| `../reference/plan.md`（仓库根 reference）                 | 架构与原则             |
| `../reference/simulation-development-plan.md`         | Schema / Phase 细节 |
| `../reference/yan-yunxiang-gift-flow-reproduction.md` | 现象分档与实验           |
| `../README.md`                                        | 工程启动命令            |

---

## 附录 D — Phase 0–3 代码索引

> 路径均相对 `myProject/`。入口脚本见 `package.json`。

### D.0 工程骨架与编排

| 职责        | 路径                                   | 说明                                                  |
| --------- | ------------------------------------ | --------------------------------------------------- |
| 实验编排      | `sim/backend/engine/experiment.ts`   | 组装时钟、事务、规则、日志；`SlotHandlers` 挂接 generate → process  |
| 时钟主循环     | `sim/backend/engine/scheduler.ts`    | `TimeScheduler.runSlots`；月初 / 生成 / 处理 / 礼窗检查        |
| 空跑入口      | `sim/backend/engine/run_empty.ts`    | `npm run sim:empty`                                 |
| P1 实验入口   | `sim/backend/engine/run_p1.ts`       | `npm run sim:p1`；婚礼 scheduled + 工具礼 + 回礼            |
| P2 实验入口   | `sim/backend/engine/run_p2.ts`       | `npm run sim:p2`；婚礼 → 对话 → RuleEngine 结算            |
| 世界状态      | `sim/backend/store/world_state.ts`   | agents / relationships / giftLedger / PET / metrics |
| 冻结 Schema | `sim/shared/types/index.ts`          | `SimTime`、`AgentState`、`LogEntry`、`WorldSnapshot` 等 |
| 事件模板类型    | `sim/shared/types/event_template.ts` | `RoleSlot`、`GoalTemplate`、`EventTemplate`           |

### D.1 Phase 0 — 基础设施与契约

| 任务 ID | 代码位置                                                                                        | 要点                                                        |
| ----- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| P0-01 | `sim/shared/types/`、`tsconfig.json`                                                         | 共享类型与编译配置                                                 |
| P0-02 | `sim/backend/engine/scheduler.ts`                                                           | `TimeScheduler`；`runSlots(N)`；`timeslot.start/end`        |
| P0-03 | `sim/backend/log/log_writer.ts`、`sim/backend/store/snapshot_store.ts`                       | JSONL append-only；每 slot 写 snapshot + `replay_index.json` |
| P0-04 | `sim/backend/rules/rule_engine.ts`                                                          | `RuleEngine.commit`；非法提案 → `rule.rejected` + before/after |
| P0-05 | `sim/data/agents.json`、`sim/data/relationships.json`、`sim/backend/systems/person/loader.ts` | 10 人种子；kinship / workplace / community                    |
| P0-06 | `sim/backend/store/replay_engine.ts`、`sim/backend/api/replay.ts`                            | `seekTo` / `seekToSeq`；前端 HTTP 适配                         |
| P0-07 | `sim/backend/engine/run_empty.ts`、`verify_p0.ts`、`verify_d1.ts`                             | `npm run sim:empty`、`verify:p0`                           |
| P0-09 | `sim/backend/llm/client.ts`、`sim/backend/llm/ping.ts`、`.env.example`                        | `AGENTSOCIETY_LLM_*`；`createLlmClient(mock\|live\|auto)`  |

**P0 产物示例**：`sim/data/runs/<runId>/event_log.jsonl`、`snapshots/D*-*.json`、`replay_index.json`

### D.2 Phase 1 — 事务系统

| 任务 ID | 代码位置                                                                         | 要点                                                                          |
| ----- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| P1-01 | `sim/backend/systems/event/library.ts`、`sim/data/event_templates/*.json`     | `EventTemplateLibrary.loadFromDir`；3 公共 + 3 私人                              |
| P1-02 | `sim/backend/systems/event/resolver.ts`、`sim/backend/systems/event/goals.ts` | `RoleResolver`（kinship / neighbor / tag_match 等）；`GoalInstantiator`         |
| P1-03 | `sim/backend/systems/event/generator.ts`                                     | `generateManual` + `generateScheduled` → `EventInstance`                    |
| P1-05 | `sim/backend/systems/event/scheduler.ts`                                     | 队列 + `occupancy=required` 冲突 → `event.rejected`                             |
| P1-06 | `sim/backend/engine/experiment.ts`、`sim/backend/systems/event/pipeline.ts`   | 单 slot：`onGenerateEvents` → `onProcessEvents` → `EventPipeline.process`     |
| P1-07 | `sim/backend/systems/event/pet.ts`                                           | `PersonalEventTableManager.propagate`；知情时间/来源/confidence                    |
| P1-08 | `sim/backend/cognition/bdi.ts`、`sim/backend/systems/person/manager.ts`       | PET → Belief；Goals → Desire/Intention；`bdi.updated` 日志                      |
| P1-09 | `sim/backend/systems/event/pipeline.ts`（`executeGoal`）                       | `give_gift` / `repay_gift` / `donate` 经 `RuleEngine.commit`                 |
| P1-10 | `sim/backend/log/log_writer.ts` + 各系统 `log.append`                           | `event.created/propagated/completed/rejected`、`gift.*`、`relationship.delta` |
| P1-11 | `sim/backend/engine/verify_p1.ts`、`run_p1.ts`                                | 一键验收；`LATEST_P1_RUN.txt` 指向最近 run                                           |

**P1 数据流**：

```
TimeScheduler.step
  → EventGenerator (manual / scheduled)
  → EventScheduler.enqueue
  → EventPipeline: PET → Belief → BDI → executeGoal → RuleEngine
  → gift_window_check (月末 slot handler)
```

### D.3 Phase 2 — 对话与个人属性

| 任务 ID | 代码位置                                                                             | 要点                                                        |
| ----- | -------------------------------------------------------------------------------- | --------------------------------------------------------- |
| P2-01 | `sim/backend/systems/dialogue/prompt.ts`                                         | `PublicPromptBuilder` / `PrivatePromptBuilder`            |
| P2-02 | `sim/backend/systems/dialogue/prompt.ts`                                         | `DialogPromptBuilder`：Self + Other + Edge + PET + 礼债      |
| P2-03 | `sim/backend/systems/dialogue/controller.ts`                                     | `DialogueController.run`；4–8 轮；礼事务可强制短对话                  |
| P2-04 | `sim/backend/systems/dialogue/controller.ts`                                     | 模式 `dialogue` / `host` / `random`（换 system 约束）            |
| P2-05 | `sim/backend/systems/dialogue/style.ts`、`sim/backend/cognition/emothon.ts`       | BigFive + Emotion → `StyleProfile` → 语气参数                 |
| P2-06 | `sim/backend/systems/dialogue/summarizer.ts`                                     | `DialogueSummarizer`；摘要 + `keyFacts` 写 BDIE               |
| P2-07 | `sim/backend/systems/dialogue/table.ts`                                          | `ConversationTable`；`conversation_table.jsonl` 按 `cid` 查询 |
| P2-08 | `sim/backend/rules/rule_engine.ts`（`dialogue_bdie`、`relationship_delta`）         | 情感分 clamp 后改关系 / BDIE                                     |
| P2-09 | `sim/data/knowledge/gift_norms.json`、`sim/backend/systems/dialogue/knowledge.ts` | 10 条礼俗 norm；`KnowledgeBase.search` 注入 prompt              |
| P2-10 | `sim/backend/llm/client.ts` + `run_p2.ts`                                        | `P2_LLM_MODE=mock\|live`；无 key 自动 mock                    |
| P2-11 | `sim/backend/systems/dialogue/controller.ts`                                     | `dialogue.start/message/end` 写入 `event_log.jsonl`         |
| P2-12 | `sim/backend/engine/verify_p2.ts`、`run_p2.ts`                                    | mock 三轮模式验收；live 配置检测                                     |

**P2 数据流**（`run_p2.ts`）：

```
generateManual(wedding) → EventScheduler
  → DialogueController.run (×3 modes)
      → DialogPromptBuilder + KnowledgeBase + LLM
      → RuleEngine (dialogue_bdie, relationship_delta)
      → DialogueSummarizer → ConversationTable
  → executeGoal(give_gift) → RuleEngine
  → snapshot（含 conversations 字段）
```

**P2 产物示例**：`sim/data/runs/<runId>/conversation_table.jsonl`、snapshot 内 `conversations`

### D.4 Phase 3 — 关系深化与认知树

| 任务 ID | 代码位置                                                                             | 要点                                                              |
| ----- | -------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| P3-01 | `sim/backend/systems/relationship/graph.ts`                                      | CRUD + `neighbors` / `incoming` 社交圈查询                           |
| P3-02 | `sim/shared/types/index.ts`（`RelationshipEdge`）                                  | `giftDebt` / `reciprocityScore` / `relationAxis`                |
| P3-03 | `rule_engine.ts` + `dialogue/controller.ts` + `gift_window_check`                | 对话 / 礼物 / 违约三通道；每条 `relationship.delta` 含 reason+formula        |
| P3-04 | `systems/relationship/summarizer.ts` + `dialogue/prompt.ts`                      | `[关系摘要]` 注入 DialogPromptBuilder                                 |
| P3-05 | `cognition/cognitive_tree.ts` + `dialogue/controller.ts`                         | dialogue 归档；`influenceSum≥15` → relation；写 `cognitive.promoted` |
| P3-06 | （桩）`CognitiveTreeManager.tryPromoteRelationToCircle`                             | circle/social → P6                                              |
| P3-07 | `cognition/bdi.ts`（`syncRepayIntentionsFromLedger` / `listActionableIntentions`） | I←回礼窗；违约后清理；高优先 Intention 可观测                                   |
| P3-08 | `rule_engine.ts`（`applyRitualFacePrestige`）                                      | 仪式收礼 host.prestige↑；同场高额 giver.face↑                            |
| P3-09 | `frontend/replay/`（`app.js` SVG 关系图）+ `export_demo_data.ts`                      | 边粗细=trust、透明度=intimacy；seek 可看                                  |
| P3-10 | `engine/verify_p3.ts`、`run_p3.ts`                                                | 一键验收；`LATEST_P3_RUN.txt`                                        |

**P3 数据流**（`run_p3.ts`）：

```
wedding Event → PET/Belief
  → DialogueController（关系摘要+认知树 prompt）
      → relationship.delta(dialogue) + cognitive archive/promote
  → EventPipeline → give_gift → relationship.delta(gift) + R5 prestige
      → syncRepayIntentionsFromLedger
  → short-window gift → gift_window_check → relationship.delta(defaulted)
  → snapshot（含 cognitiveTrees）
```

**P3 产物示例**：snapshot 内 `cognitiveTrees`；日志 `cognitive.promoted`；前端关系图

### D.5 跨 Phase 共用

| 系统   | 路径                                               | 说明                                          |
| ---- | ------------------------------------------------ | ------------------------------------------- |
| 规则引擎 | `sim/backend/rules/rule_engine.ts`               | 礼物 / 经济 / 关系 / 对话 BDIE / R5 唯一写入口           |
| 关系图  | `sim/backend/systems/relationship/graph.ts`      | `RelationshipGraph`；`giftRelationshipDelta` |
| 关系摘要 | `sim/backend/systems/relationship/summarizer.ts` | Prompt 可读摘要                                 |
| 经济   | `sim/backend/systems/economy/manager.ts`         | 月初结算；双边现金转账                                 |
| 礼单   | `sim/backend/systems/gift/ledger.ts`             | pending → replied / defaulted 窗口状态机         |
| 认知树  | `sim/backend/cognition/cognitive_tree.ts`        | dialogue→relation；circle/social 留 P6        |
| 前端回放 | `sim/frontend/replay/`、`sim/frontend/serve.ts`   | 时间轴 + 关系图；`npm run frontend:serve`          |
| 演示导出 | `sim/backend/engine/export_demo_data.ts`         | `npm run frontend:export`                   |

**最近验收 run**（`sim/data/runs/`）：

| 指针文件                   | 含义                          |
| ---------------------- | --------------------------- |
| `LATEST_EMPTY_RUN.txt` | 最近一次 `sim:empty`            |
| `LATEST_P1_RUN.txt`    | 最近一次 `sim:p1` / `verify:p1` |
| `LATEST_P2_RUN.txt`    | 最近一次 `sim:p2` / `verify:p2` |
| `LATEST_P3_RUN.txt`    | 最近一次 `sim:p3` / `verify:p3` |
| `LATEST_SEED_RUN.txt`  | 最近一次 `sim:seed-gifts`       |
