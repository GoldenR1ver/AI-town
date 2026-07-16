# AI-town 社会学扩展清单（Schema + 更新规则 + Hook 对接）

本文给出一版可直接落地到当前 AI-town 架构的扩展设计，结合以下理论框架：

- Coleman：社会资本（信任、义务、信息通道、规范）
- Ostrom：公共池资源（规则、监测、制裁、集体治理）
- Goffman：互动仪式（面子、礼貌、情绪能量、互动链）

目标是把“对话驱动的小镇”扩展为“可计算社会关系 + 制度演化”模拟器。

---

## 0. 与现有代码的约束对齐

当前 AI-town 的关键约束：

- 游戏状态主循环在 `convex/aiTown`（tick + input）
- Agent 异步认知在 `convex/agent`（LLM、记忆）
- 关系线索仅有 `participatedTogether`，尚无结构化关系分数
- Conversation 默认双人，状态机稳定

因此建议：

1. 新增社会学状态表放在 Convex 普通表（不强塞入 `worlds` 热状态）
2. 在“事件发生点”用 hook 更新状态（输入处理、消息写入、对话结束、周期任务）
3. 决策侧先做“规则主导 + LLM 辅助评分”

---

## 1. 统一数据 Schema（跨理论共享）

建议在 `convex/sociology/schema.ts` 新增表，并合并到主 `convex/schema.ts`。

### 1.1 二元关系表 `relationships`

用途：刻画 A 对 B 的定向关系（非对称）。

建议字段：

- `worldId: Id<'worlds'>`
- `subjectId: playerId`（关系发出者）
- `targetId: playerId`（关系对象）
- `trust: number`（0~100）
- `affection: number`（-100~100）
- `authorityLegitimacy: number`（0~100，A 认为 B 的正当性）
- `cooperationPropensity: number`（0~1）
- `giftDebt: number`（A 对 B 的礼物债务，正值代表欠债）
- `interactionRitualScore: number`（-100~100）
- `lastInteractionAt: number`
- `updatedAt: number`

索引建议：

- `by_world_subject_target: [worldId, subjectId, targetId]`（唯一性逻辑）
- `by_world_subject: [worldId, subjectId]`
- `by_world_target: [worldId, targetId]`

### 1.2 个体状态表 `socialActors`

用途：刻画个体可累积的社会属性（不针对某个对象）。

字段建议：

- `worldId`
- `playerId`
- `statusRank: number`（地位）
- `face: number`（面子资本，Goffman）
- `emotionalEnergy: number`（互动后情绪能量）
- `normCompliance: number`（遵约倾向 0~1）
- `sanctionCount: number`
- `reputation: number`（公共声誉）
- `updatedAt`

索引：

- `by_world_player: [worldId, playerId]`
- `by_world_rank: [worldId, statusRank]`

### 1.3 礼物与义务表 `giftLedger`

用途：实现 Mauss 风格礼物交换与互惠链。

字段建议：

- `worldId`
- `fromPlayerId`
- `toPlayerId`
- `itemType: string`（先字符串，后续可转 enum）
- `quantity: number`
- `symbolicValue: number`（社会意义价值）
- `materialValue: number`（物质价值）
- `createdAt: number`
- `dueAt?: number`（期待回礼时间）
- `repaidAt?: number`
- `status: 'open' | 'repaid' | 'defaulted'`

索引：

- `by_world_to_status: [worldId, toPlayerId, status]`
- `by_world_from_status: [worldId, fromPlayerId, status]`

### 1.4 公共记忆表 `publicMemories`

用途：共享叙事和共同体记忆（区别于私有 `memories`）。

字段建议：

- `worldId`
- `eventType: 'conflict' | 'cooperation' | 'gift' | 'rule_change' | 'crisis' | 'ritual'`
- `title: string`
- `description: string`
- `participants: playerId[]`
- `location?: { x: number; y: number }`
- `salience: number`（显著性）
- `embeddingId?: Id<'memoryEmbeddings'>`（可选复用向量索引）
- `createdAt: number`
- `expiresAt?: number`

索引：

- `by_world_created: [worldId, createdAt]`
- `by_world_type_created: [worldId, eventType, createdAt]`

### 1.5 公共池资源表 `commonsResources`（Ostrom 核心）

用途：模拟池塘、森林、水井等 CPR。

字段建议：

- `worldId`
- `resourceId: string`（逻辑 ID）
- `name: string`
- `stock: number`
- `regenRate: number`（每周期再生）
- `capacity: number`
- `extractionCost: number`
- `monitoringLevel: number`（0~1）
- `ruleSetVersion: number`
- `updatedAt`

索引：

- `by_world_resourceId: [worldId, resourceId]`

### 1.6 规则与治理表 `institutionRules`

用途：记录社区规则、阈值、制裁阶梯。

字段建议：

- `worldId`
- `domain: 'gift' | 'commons' | 'speech' | 'authority'`
- `ruleKey: string`
- `ruleValue: string`（JSON 字符串）
- `legitimacy: number`（集体认可度）
- `introducedBy?: playerId`
- `createdAt`
- `updatedAt`

索引：

- `by_world_domain_key: [worldId, domain, ruleKey]`

### 1.7 工作与生产表（建议最小实现）

最低限度两个表：

1. `workProfiles`
   - `worldId`, `playerId`
   - `role: string`（farmer, trader, guard...）
   - `skill: number`
   - `workEthic: number`（0~1）
   - `fatigue: number`（0~100）
2. `inventories`
   - `worldId`, `playerId`
   - `itemType`
   - `quantity`
   - `updatedAt`

---

## 2. 更新规则（规则主导 + LLM 辅助）

以下规则默认以事件驱动执行，避免每 tick 全量重算。

## 2.1 Coleman 社会资本规则

### A. 信任 `trust`

初始化：

- 新关系默认 `trust = 50`

更新：

- 成功合作：`trust += 6 + 4 * cooperationOutcomeQuality`
- 违约/食言：`trust -= 12`
- 礼物被回礼：`trust += 5`
- 礼物长期不回：`trust -= 8`
- 对话积极情感（LLM 或规则情感分 > 阈值）：`trust += 1~3`

衰减：

- 每 24h 无互动：`trust -= 1`（下限 0）

### B. 义务网络 `giftDebt`

- A 给 B 礼物后，`giftDebt(B->A) += symbolicValue`
- B 回礼后按价值抵扣
- `giftDebt` 过大且超期，触发负面公共记忆（违约标签）

### C. 信息通道（近似实现）

- 当 A 与 B 高频互动，A 获取 B 的“二跳口碑”权重提升
- 可通过 `publicMemories.salience` + `relationships.trust` 做加权扩散

### D. 规范与制裁

- 对共同规则违规（如过度采集）：
  - `normCompliance` 下降
  - `sanctionCount` 增加
  - 被监测到后信任和声誉下降

## 2.2 Ostrom 公共池规则

### A. 资源动态

- 每周期（如 1 分钟）：
  - `stock = min(capacity, stock + regenRate - totalExtraction)`

### B. 提取策略

- 个体决策中加入：
  - 期望收益 = 提取收益 - 违规风险成本 - 声誉损失

违规判定：

- 若提取量 > 配额（来自 `institutionRules`），记违规事件

### C. 监测与分级制裁

- 被监测概率：`monitoringLevel * observerPresenceFactor`
- 制裁阶梯（可配置）：
  1. 警告
  2. 声誉扣分
  3. 暂时禁止采集

### D. 集体治理

- 定期（如每日）触发“规则修订窗口”：
  - 根据资源枯竭率、违规率调整配额和制裁强度
  - `institutionRules.legitimacy` 随服从率变化

## 2.3 Goffman 互动仪式规则

### A. 面子 `face`

- 被公开尊重：`face +`
- 被公开羞辱/打断：`face -`
- 在冲突后礼貌修复（道歉 + 接受）：双方 `face` 部分恢复

### B. 情绪能量 `emotionalEnergy`

- 成功互动（轮次顺畅、互相回应）：`+`
- 尴尬中断/冷场：`-`
- 高能量个体更主动发起互动（提高邀约概率）

### C. 仪式链 `interactionRitualScore`

- 对话结束计算一次：
  - turn-taking 平衡
  - 正向词比例
  - 引用共同记忆次数
  - 礼貌收尾是否出现
- 分数写入 `relationships.interactionRitualScore`
- 连续高分关系将更容易形成“稳定圈层”

---

## 3. 与现有 Hook/代码对接清单

以下是“插桩点 -> 应做更新”的落地映射。

## 3.1 对话开始 / 继续 / 结束

### Hook 点 1：`convex/aiTown/conversation.ts`

建议对接：

- 在 `Conversation.stop` 之后触发 `sociology.onConversationEnded`
  - 输入：`worldId`, `conversationId`, `participants`, `numMessages`, `lastMessage`
  - 动作：
    - 更新 `relationships`（trust/affection/ritual）
    - 写 `publicMemories`（高显著事件）

### Hook 点 2：`convex/agent/conversation.ts`

建议对接：

- `startConversationMessage` / `continueConversationMessage` prompt 注入：
  - 读取双方关系变量（trust/authority/affection）
  - 读取公共记忆摘要（最近 N 条）
  - 读取规则上下文（如公共池禁令）

## 3.2 消息写入时

### Hook 点 3：`convex/messages.ts` 和 `internal.aiTown.agent.agentSendMessage`

建议对接：

- 写入消息后异步调度 `sociology.onMessageWritten`
  - 快速文本评分（礼貌、攻击、合作提议）
  - 累积到“对话临时统计”表（可选 `conversationMetrics`）
  - 避免每条消息都跑重 LLM，可用轻量规则 + 抽样 LLM

## 3.3 邀约候选选择

### Hook 点 4：`convex/aiTown/agent.ts:findConversationCandidate`

现状按距离排序；建议改为综合评分：

- `score = w1*distanceScore + w2*trust + w3*affection + w4*ritual - w5*recentConflict`
- 低信任但高权威对象可在“命令场景”中仍被选中

## 3.4 行为决策

### Hook 点 5：`convex/aiTown/agentOperations.ts:agentDoSomething`

新增行为分支（输入名可在 `agentInputs.ts` 注册）：

- `proposeCooperation`
- `giveGift`
- `extractCommonsResource`
- `performWork`
- `reportViolation`

每个行为完成后调用对应 sociology mutation 更新状态。

## 3.5 记忆写入

### Hook 点 6：`convex/agent/memory.ts:rememberConversation`

建议对接：

- 记忆摘要生成后，额外抽取结构化标签：
  - `sentiment`, `respectSignal`, `promiseMade`, `promiseKept?`
- 标签用于关系更新，不仅依赖自由文本

## 3.6 周期任务（cron）

### Hook 点 7：`convex/crons.ts`

新增 cron：

1. `sociologyDecay`（每日）
   - 信任/好感衰减，过期礼物违约处理
2. `commonsRegenAndAudit`（每 1~5 分钟）
   - 资源再生、违规检测、制裁执行
3. `institutionReview`（每日或每周）
   - 根据指标调整规则参数，记录 `rule_change` 公共记忆

---

## 4. 建议新增函数接口（Convex）

在 `convex/sociology/` 下组织：

- `schema.ts`：上述表定义
- `queries.ts`
  - `getRelationship(worldId, subjectId, targetId)`
  - `getPublicMemoryDigest(worldId, playerId)`
  - `getInstitutionContext(worldId)`
- `mutations.ts`
  - `upsertRelationshipDelta(...)`
  - `recordGift(...)`
  - `settleGiftDebt(...)`
  - `applyCommonsExtraction(...)`
  - `applySanction(...)`
- `actions.ts`（可选重计算任务）
  - `scoreConversationRitual(...)`
  - `derivePublicEventFromConversation(...)`

---

## 5. 最小可行落地顺序（建议）

1. `relationships + socialActors` 两表先落地
2. 对接 `Conversation.stop`（一次更新 trust/affection/ritual）
3. 改 `findConversationCandidate` 用关系加权排序
4. 加 `publicMemories`，并在 prompt 注入
5. 上 `giftLedger + giveGift input`
6. 最后加 `commonsResources + institutionRules`

---

## 6. 参数初始化建议（默认值）

可先放 `convex/sociology/constants.ts`：

- `INITIAL_TRUST = 50`
- `INITIAL_AFFECTION = 0`
- `INITIAL_COOP_PROPENSITY = 0.5`
- `TRUST_DECAY_PER_DAY = 1`
- `GIFT_DEFAULT_DUE_DAYS = 3`
- `RITUAL_SCORE_MIN_MESSAGES = 3`
- `SANCTION_REPUTATION_PENALTY = 5`

---

## 7. 评估指标（用于仿真研究）

每轮实验至少记录：

- 关系网络指标：平均信任、聚类系数、互惠率
- 互动指标：对话频次、仪式得分分布、冲突率
- 公共池指标：资源存量波动、违规率、治理合法性
- 制度涌现指标：稳定团体数量、规则更迭频率、权威集中度

这些指标可通过新增 `simulationMetrics` 表聚合。

---

## 8. 兼容性说明

- 该设计不要求破坏当前引擎主循环，优先通过“普通表 + hook mutation/action”接入
- 若后续要支持真正多人协商，可再扩展 conversation 从双人到多人
- 规则可先手工参数化，后续再加“实验配置 profile”

---

## 9. 7~14 天任务拆分（面向课程汇报）

说明：以下按“一个小而完整版本”设计，优先满足老师给出的五个验收关注点。

### 9.1 范围收敛（必须）

- NPC 数量：`3~5`
- 礼物类型：`3~6`
- 关系变量：`trust`, `affection`, `giftDebt`, `reciprocityScore`
- 实验分组：至少两组（`无记忆 vs 有记忆`，`无互惠规则 vs 有互惠规则` 二选一也可）
- 结果交付：可导出事件日志 + 一页对比图表

### 9.2 Day 1-2：架构与数据骨架

- 新增 `convex/sociology/schema.ts`（先上 `relationships`, `giftLedger`, `publicMemories`）
- 在 `convex/schema.ts` 合并 sociology tables
- 新增最小函数：
  - `queries.getRelationship`
  - `mutations.upsertRelationshipDelta`
  - `mutations.recordGift`
- 定义事件日志结构（见第 11 节）

里程碑 M1：

- 本地可部署，表结构与基础 mutation/query 可运行
- 能手动写入一条礼物事件并观察关系分数变化

### 9.3 Day 3-5：核心闭环（observe -> retrieve -> plan -> commit -> reflect）

- `observe`：读取附近玩家、当前关系、未偿礼物债务
- `retrieve`：从私有记忆 + 公共记忆读取相关上下文
- `plan`：LLM 仅输出意图（如 `GIVE_GIFT`, `CHAT`, `RECIPROCATE`）
- `commit`：规则层校验并调用 mutation 修改状态
- `reflect`：对话或赠礼后更新关系并写 event log

具体对接点：

- `Conversation.stop` 后触发 `onConversationEnded`
- `agentDoSomething` 增加 `giveGift` / `reciprocateGift` 分支
- `findConversationCandidate` 增加关系权重

里程碑 M2：

- 至少 1 个 NPC 能自主送礼并触发关系变化
- commit 阶段规则拒绝非法状态变更（如超库存送礼）
- 每次社会行动都有 event log

### 9.4 Day 6-8：互惠规则与实验开关

- 增加互惠判定：
  - 在 `dueAt` 前回礼：关系加分
  - 超时未回礼：关系减分 + 记录违约事件
- 加实验配置开关（env 或表配置均可）：
  - `memoryEnabled`
  - `reciprocityEnabled`
- 新增批量导出脚本（CSV/JSON）

里程碑 M3：

- 可以跑两组对照并导出日志
- 关系网络指标可计算（平均信任、互惠率、回礼延迟）

### 9.5 Day 9-11：回放与可解释性

- 增加 `trace` 查询：
  - 按 `worldId + 时间范围`
  - 按 `playerId`
  - 按 `eventType`
- 做最小可视化（任选其一）：
  - 时间线列表（事件回放）
  - 关系图快照（前后对比）

里程碑 M4：

- 演示中可回放“某个礼物事件 -> 回礼/违约 -> 关系变化”的完整链路

### 9.6 Day 12-14：实验复现与汇报材料

- 固定随机种子或控制初始角色配置
- 每组至少跑 `3~5` 次，报告均值与方差（简单统计即可）
- 汇报页结构：
  1. 研究问题
  2. Agent 闭环与边界（LLM vs Rules）
  3. 规则与指标
  4. 对照结果
  5. 局限与后续

里程碑 M5（最终）：

- 代码可运行 + 实验可复现 + 结论可解释

---

## 10. 7~14 天可行性分析（你们当前工作量是否合理）

结论：**合理，但前提是严格控制范围**。  
如果你们坚持“礼物流动 + 关系网络 + 事件回放”这条主线，14 天内做出高质量汇报版是可行的。

### 10.1 可行条件

- 只做一个主扩展：`gift + reciprocity + relationship update`
- 不做大型新系统：先不做完整公共池、复杂职业系统、多人协商
- LLM 不做世界状态写入，只做意图和文本评分
- 每个功能都绑到日志与指标，不做“不可解释功能”

### 10.2 风险点（最容易超期）

- 试图同时做：礼物 + 工作 + 公共池 + 权威制度（范围过大）
- 过度依赖 LLM（成本高、输出不稳定、调参时间长）
- 没有实验脚本，最后一周才开始收集数据
- 可视化做太重（建议用最小时间线而非复杂前端图谱）

### 10.3 时间与人力建议

- 1 人：建议走 14 天版本，确保有完整实验
- 2 人：7~10 天可交付（1 人后端规则与日志，1 人实验与可视化）
- 3 人：可在 14 天内增加一个次要扩展（如公共记忆注入）

### 10.4 建议删减优先级（若时间不足）

按以下顺序砍需求：

1. 先砍“公共池/工作系统”
2. 再砍复杂可视化（保留日志导出）
3. 不砍：规则校验、事件追踪、对照实验

---

## 11. 汇报验收指标（可直接作为打分自检）

### 11.1 必达指标（老师关注点映射）

1. 世界持续推进
   - 指标：tick 持续运行，NPC 行为随时间变化
2. Agent 闭环完整
   - 指标：每个关键行动可追溯 `observe/retrieve/plan/commit/reflect`
3. LLM 与规则边界清晰
   - 指标：状态变更 100% 经过 rule mutation 校验
4. 有 trace 回放
   - 指标：可按时间和角色回放事件链
5. 至少一个清楚扩展
   - 指标：礼物-回礼-关系变化在日志和关系指标中可验证

### 11.2 量化指标（建议）

- `gift_count_total`
- `reciprocity_rate = repaid_gifts / total_opened_gifts`
- `avg_repay_delay_hours`
- `trust_delta_mean_per_day`
- `relationship_density`（关系边数量 / 最大可能边数）
- `event_trace_completeness`（关键事件字段完整率）

### 11.3 事件日志最小字段（建议强制）

- `eventId`
- `worldId`
- `timestamp`
- `eventType`（`gift_given`, `gift_repaid`, `gift_defaulted`, `relationship_updated`, `conversation_ended`）
- `actorId`
- `targetId?`
- `payload`（礼物类型、数量、价值、dueAt 等）
- `ruleChecks`（通过/拒绝原因）
- `stateDelta`（变更前后关键值）

---

## 12. 建议的最终交付包（课程汇报版）

- 代码：
  - sociology schema + hooks + gift/relationship rules
- 数据：
  - 两组实验日志（JSON/CSV）
- 演示：
  - 5 分钟 live demo（事件回放）
  - 5 分钟结果讲解（对照图 + 结论）
- 文档：
  - 一页架构图（LLM/Rules 边界）
  - 一页实验设计与指标
