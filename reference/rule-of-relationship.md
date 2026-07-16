# 关系更新规则概括（对话 + 随礼/回礼）

以下规则综合 阎云翔《礼物的流动》（义务性随礼、欠情—还情、横向/纵向互惠、人情道德）与 `plan.md` 实验设计（关系有向图、RuleEngine 三条更新通道、礼单闭环、PET→Belief 枢纽）。核心原则：LLM 只提案，关系数值变更 100% 经 RuleEngine 公式 + reason 日志。

---

## 一、原因方面：关系更新基于什么？

关系更新不是“聊过天就加好友”，而是 关系边既有结构 × 双方个人状态 × 互动/礼物属性 共同决定增量方向与幅度。

### 1.1 基于双方社会关系（至少 20 条）

1. 社会关系基础（socialBasis）：`kin / colleague / neighbor / friend / stranger / other` 决定更新 基准权重；亲属、邻里在仪式缺席/违约时惩罚更重。
2. 关系轴（relationAxis）：`horizontal | vertical_up | vertical_down` 决定回礼是否必须对等、违约是否对称处罚（纵向可非对称）。
3. 有向边的非对称性：A→B 与 B→A 独立；A 对 B 的信任上升，不自动等于 B 对 A 同幅度上升。
4. 既有亲密度（intimacy）：高 intimacy 时，同等积极对话/礼物带来 较小边际增益；低 intimacy 时单次大礼/深谈可 跃迁式 提升。
5. 既有信任度（trust）：高 trust 者对轻微失礼容忍度更高；低 trust 者同等礼物可能被解读为“有所图”。
6. 既有好感度（affection）：负 affection 下，积极对话的 trust 增益打折，甚至只升 trust 不升 affection。
7. 权威感（authority）：纵向关系中，下级送礼/对话礼貌对 authority 边 的更新权重高于 trust。
8. 合作倾向（cooperationTendency）：高合作倾向边，对话中合作提议成功时对 trust 额外加成。
9. 礼物债务（giftDebt）：B 欠 A 人情时，A→B 的 trust 更新受 debt 调制；debt 过大且超期会 压制 对话带来的正向更新。
10. 互惠历史分（reciprocityScore）：长期互惠良好者，单次礼值偏差在 ε 内不触发关系冷却。
11. 上次关系变化时间（lastChanged）：久未互动后首次对话，增益可设“重逢加成”；过久无互动则先走衰减再更新。
12. 互动摘要（interactionSummary）：历史摘要含冲突/违约标签时，后续更新需叠加 修复系数 或 惩罚系数。
13. 对话引用链（dialogueRefs）：边绑定历史 CID；高频互动边进入“稳定圈层”阈值计算。
14. 亲属公开属性对齐：`PublicProfile.kinship[]` 与 `socialBasis=kin` 必须一致，否则关系更新规则拒绝或降权。
15. 角色槽位（RoleSlot）：事务中 host/guest/kin_of_host 等角色，决定 哪条边 在仪式场景下被强制更新。
16. 圈层位置：同 clique 内对话/随礼，对 intimacy 权重大于跨圈 weak tie。
17. 实践性亲属（书中）：非血缘但义务接近 kin 的边，可映射为 `friend + high intimacy` 或单独标签，仪式义务权重上调。
18. 同事/邻里弱义务边：私交不深但职场/社区礼仪存在时，随礼/对话主要更新 trust，affection 增幅小。
19. 陌生人边（stranger）：首次对话是关系 初始化 的主要入口；首次送礼可快速建立边。
20. 公共记忆中的关系标签：如“张三曾欠礼未还”，会通过 PET 进入 Belief，间接降低后续 trust 更新上限。
21. 双向冲突状态：若 A→B 与 B→A 的 affection 一正一负，对话更新需分别计算，不能合并。
22. 权威边的单向性：vertical_up 边上，上级收礼不回礼在规则层 不视为违约，下级侧 trust 仍可能升（“懂礼数”）。
23. 桥接关系：工具性送礼后若只有单向 trust 升，需等回礼才升 reciprocityScore。
24. 关系可见性：对话 prompt 只注入 己→对方 边；更新时也仅写双方各自 outgoing 边（A→B 与 B→A 各算各的）。

### 1.2 基于双方个人状态（至少 20 条）

25. 公开信誉/面子（reputation）：高 reputation 者违约时，关系降幅更大（社会落差大）。
26. face / prestige（socialActors）：同场仪式中争面子随礼，间接影响 后续 双方边的 intimacy（被比较后）。
27. 大五人格：高 A（宜人性）→ 对话 avgSentiment 提案偏正；高 C（尽责性）→ 回礼及时，触发 trust 回礼加成。
28. Emotion.mood：高 mood 提高对话发起概率与 avgSentiment 上限；低 mood 时负向对话更易触发 affection 下降。
29. Emotion.stress：高 stress 降低 cooperationTendency 更新、提高冲突对话的 trust 惩罚。
30. Emotion.energy：energy 低时对话轮次少 → turnBalance 低 → trust/intimacy 增量小。
31. BDI.Belief：对“对方是可靠的人”置信度高，积极对话的 trust 增益放大；对“对方欠我情”置信度高，收礼前 trust 冻结。
32. BDI.Desire：如“维系关系”“还人情”优先级高，驱动送礼/回礼事务，从而触发关系更新。
33. BDI.Intention：收礼后 I 中回礼计划到期，触发 reply_gift → 关系第二次更新。
34. StyleProfile：由属性推导，影响 LLM 对话礼貌分与 BDIE influence 提案，不直接改 trust。
35. 经济 cash：决定礼值上限；礼值不足导致“失礼”分支，关系降而非升。
36. 收入（income）：`minGiftNorm` 可设为 income 的函数；低于规范礼数触发关系惩罚。
37. 职业/社会标签（occupation, socialTags）：调制对同场礼数的期望值，影响“够不够意思”的关系解读。
38. 年龄/生命周期：婚丧场合中，不同年龄段 agent 的 义务强度 不同，影响缺席时的关系降幅。
39. normCompliance（遵约倾向）：高者更按时回礼 → 更多触发“窗内回礼 +trust”分支。
40. sanctionCount：有公共违约记录者，其发起的对话 trust 增益上限被 clamp。
41. 认知树—关系层节点：如“李四值得信赖”，对话结束后可上呈，间接巩固 trust（MVP 可后置）。
42. PET 置信度：高置信 PET（“听说张三婚礼没随礼”）影响 Belief，降低未来与张三边的更新上限，即使尚未直接对话。
43. 对话模式（dialogue / host / random）：主持人模式下 turnBalance 计算方式不同，影响 intimacy 增量。
44. BDIE 影响力分数（influence）：对话表记录的 LLM 提案，经 clamp 后进入公式 `0.1*influence` 等项。
45. 实验开关：`memoryEnabled` 影响 agent 是否记得 debt 并及时回礼；`reciprocityEnabled` 决定是否启用 R2–R4 回礼/对等规则。
46. 互动仪式分（interactionRitualScore，扩展）：连续高分对话累积，使后续 trust 衰减更慢。
47. Emotional energy（扩展）：成功对话后升高，提高下次对话/送礼发起率，间接增加关系更新频次。
48. Emotion 不直接改 trust（plan 原则）：情绪只进 StyleProfile 与 BDIE 提案，最终 trust 仍走公式。

### 1.3 基于礼物属性（至少 20 条）

49. 价值（value）：绝对礼值越大，trust/affection/intimacy 基准增量越大（含 `0.001*adjustedValue` 等项）。
50. 表达性分数（expressiveScore）：高表达性 → affection/intimacy 权重大；`affection += 0.002 * expressiveScore * value`。
51. 工具性分数（instrumentalScore）：高工具性 → 更依赖 adjustedValue 与回礼对等，affection 增幅相对小。
52. 折算价值（adjustedValue）：`value × (1 - expressiveScore%)`；回礼是否“足额”以 adjustedValue 为阈值。
53. 礼物方向（from → to）：更新 双向边：送礼者 A→B 与收礼者 B→A 规则不同（收礼方还欠 debt）。
54. occasion 类型：`wedding | funeral | birthday | ritual | instrumental` 决定 minGiftNorm 与更新幅度系数。
55. 是否关联仪式事务（eid）：仪式随礼失败（缺席/低于 norm）→ 关系 惩罚 大于普通工具礼。
56. replyWindowEnd：是否在窗口内回礼，决定走“回礼成功”还是“违约”更新分支。
57. status：`pending_reply | replied | defaulted | closed` 触发不同关系更新器。
58. replyGid 关联：回礼记录与原礼单配对，用于计算 reciprocityScore 与 debt 抵扣。
59. symbolicValue vs materialValue（扩展）：debt 累积用 symbolicValue；cash 扣减用 materialValue。
60. 同场礼数比较：多人同场给同一 host，低于中位数/ norm 者，关系增益打折或转惩罚。
61. relationAxis × 礼值差 |Δv|：横向超 ε 长期累积 → 关系冷却；纵向可豁免。
62. 首次礼 vs 重复礼：对 stranger 边，首次礼的 intimacy 跃迁系数更高。
63. 礼物描述/叙事（description）：仅进对话与日志，不直接改数值；但可影响 LLM 的 avgSentiment 提案。
64. instrumental 办事礼：事办成与否（事务 outcome）调制 trust 二次更新（B 档）。
65. vertical_up 象征回礼：回礼 value 可小于原礼，仍算 `replied`，trust +5 但 reciprocityScore 按不对等记录。
66. vertical_down 赠礼不足：低于期望 → 损收礼方对送礼方的 authority/trust。
67. 违约公开性：仪式礼单公开时，defaulted 对 reputation、publicMemories 的连带更新更重，进而影响关系边。
68. debt 抵扣比例：回礼 value 抵扣 `giftDebt(B→A)` 的比例，影响剩余 debt 是否继续压制 trust 更新。
69. expressive 高 + value 低：“情到了礼轻”——affection 可升，trust 升幅小；若场合要求 minGiftNorm 则仍可能罚。
70. closed 礼单：不再触发关系更新，但历史 reciprocityScore 保留。

---

## 二、过程方面：关系更新的一般流程与触发场景

### 2.1 一般流程（至少 20 条）

1. 时间槽启动：`timeslot.start` → EventGenerator 产生/排队事务。
2. 事务触发对话：EventScheduler 对 required 事务 强制开启对话（送礼事务亦如此）。
3. Prompt 拼接：`Self + Other(公开) + Edge(self→other) + PET + 认知树 + StyleProfile`。
4. LLM 生成对话：输出自然语言 + BDIE 影响提案（avgSentiment、influence 等）。
5. 对话进行中（可选）：每条 message 可累积临时 metrics（礼貌、攻击、合作提议），供结束时汇总。
6. dialogue.end：对话结束是 对话通道关系更新的唯一正式入口（MVP）。
7. RuleEngine 读取对话表：取 `avgSentiment`、`turnBalance`、`influence`（均已 clamp）。
8. 套用对话公式更新边：
   - `trust += clamp(2*avgSentiment + 0.1*turnBalance + 0.05*influence, -5, 5)`
   - `affection += clamp(3*avgSentiment + 0.1*influence, -8, 8)`
   - `intimacy += clamp(1.5*avgSentiment + 0.2*turnBalance, -3, 3)`
9. 分别更新 A→B 与 B→A：双方各自 outgoing 边，基于 各自视角 的 sentiment/ influence（若对称则相同）。
10. 写 relationship.delta 日志：`before / after / reason / formula / cid`。
11. 更新边元数据：`lastChanged`、`dialogueRefs.push(cid)`、`interactionSummary` 刷新。
12. 认知树 dialogue 层写入：单次对话节点；影响力超阈值则上呈至 relation 层（MVP 可简化）。
13. BDI 更新（间接）：对话涉及的 PET/Belief 变更 不直接改 trust；Belief 影响 下一次 互动与送礼决策。
14. 送礼意图 commit：`gift 事务` → 强制短对话 → RuleEngine 校验 cash → 扣款 → 写 GiftRecord。
15. 送礼关系更新（即时）：
    - `trust += 2 + 0.001*adjustedValue`
    - `affection += 3 + 0.002*expressiveScore*value`
    - `intimacy += 1 + 0.001*expressiveScore*100`
16. 写 giftDebt：`giftDebt(B→A) += symbolicValue`（或 adjustedValue，按配置）。
17. 收礼者 BDI.I 写入回礼 intention：指定 target、窗口、最低 adjustedValue。
18. slot 内 giftWindowCheck：扫描 `pending_reply` 且 `now > replyWindowEnd` → 违约分支。
19. 回礼 commit：`reply_gift` → 新 GiftRecord → 关联 `replyGid` → 抵扣 debt。
20. 回礼成功关系更新：窗内且 `replyValue >= adjustedValue` → 在送礼公式基础上 额外 trust +5（Coleman 规则）/reciprocityScore↑。
21. 回礼不足/超时关系更新：
    - `trust -= 8; affection -= 12; intimacy -= 5`
    - `gift.defaulted` 日志 + 可选 publicMemories。
22. 仪式 batch 结算：同场 occasion 结束后，对 host–guest 边批量应用 norm 校验结果（出席+达标 / 缺席 / 失礼）。
23. 关系衰减 cron（扩展）：每 24h（或每 N slot）无互动 → `trust -= 1`（下限 0）。
24. snapshot@slotEnd：关系图写入 slot 快照，供 replay 与前端关系图。
25. 拒绝路径也记日志：RuleEngine 拒绝非法更新时，`relationship.delta` 记 `rejected + reason`，状态不变。

### 2.2 触发场景（至少 20 条）

#### 对话触发

26. 私人事务强制对话：红白喜事、购房、生育等 → 对话结束 → 关系更新。
27. 公共事务强制对话：社区规则、防灾、冲突调节 → 合作/冲突 sentiment 不同 → trust/affection 方向不同。
28. Agent 主动 chat：`agent_driven` 或 heuristic 选 `chat` → 非事务对话仍走 dialogue.end 更新。
29. 送礼前后强制短对话：礼物事务绑定对话 → 同 slot 可能连续两次更新（对话 + 送礼）。
30. 回礼前后对话：reply_gift 事务亦可绑定确认性对话。
31. 冲突事务对话：争吵/调解 → avgSentiment 负 → trust/affection 降。
32. 主持人模式对话：仪式、公共集会 → turnBalance 与 influence 计算规则不同。
33. 事务传播对话：PET 传播后，知情者与被传播者对话 → 间接影响对第三方的 Belief，下次与第三方对话时更新不同。
34. 承诺对话（promiseMade 标签）：对话提取“答应回礼/帮忙” → 后续履约/违约触发 第二次 关系更新。
35. 道歉修复对话：冲突后礼貌收尾 → face 部分恢复 + trust 小幅回升（扩展 Goffman 规则）。

#### 随礼/回礼触发

36. 婚礼/葬礼/生日 occasion 随礼：达标 → 关系升；低于 minGiftNorm → 关系降。
37. 缺席仪式且未人不到礼不到：对 host 边 trust/affection/intimacy 显著降 + reputation 连带。
38. 日常工具性送礼：办事、拉关系 → 主要升 trust，affection 视 expressiveScore。
39. 收到礼后 pending_reply 状态：此时关系已在送礼时升过一次；回礼成功 再升 或至少维持 reciprocityScore。
40. I 中回礼 intention 到期：agent_driven `reply_gift` → 回礼成功更新。
41. giftWindowCheck 超时：无 action → defaulted 惩罚更新。
42. 回礼 value < adjustedValue：部分抵扣 debt，但仍走 不足回礼 惩罚（可配置为减半惩罚）。
43. 横向长期 |Δv| > ε：reciprocityScore 降 → 触发“关系冷却”额外 trust/intimacy 负向修正。
44. 纵向 upward 象征回礼：status=replied 但 value 不对等 → trust 小升，reciprocityScore 记录 asymmetry。
45. 同场随礼竞争：高额随礼者在 A→host 边上 intimacy/trust 额外加成。
46. 公共礼单曝光后补礼：延迟送礼仍可能避免最差惩罚，但 trust 增益减小。
47. 经济月初结算后：cash 变化 → 新一轮送礼能力 → 间接决定下月关系更新频次。
48. 实验 E1（memoryEnabled）：记得 debt → 回礼更及时 → 更多“回礼成功”正向更新。
49. 实验 E2（reciprocityEnabled）：无规则组几乎只有对话更新；有规则组礼物通道完整。
50. 违约 publicMemory 写入后：第三方与违约者对话/送礼时，trust 更新上限降低。

---

## 三、影响方面：更新哪些属性？关系与哪些组件相关？

### 3.1 关系更新直接修改的边字段（至少 20 条）

1. trust（信任度）：对话/送礼/回礼/违约的主变量；范围 0~100。
2. affection（好感度）：对话情感与 expressive 礼驱动；范围 -100~100。
3. intimacy（亲密度）：长期交往深度；对话 turnBalance 与仪式礼驱动。
4. authority（权威感）：纵向礼、冲突对话、上级/下级互动中更新（plan 需求 + 扩展）。
5. cooperationTendency（合作倾向）：合作类对话、公共事务对话、成功互惠后更新。
6. giftDebt：送礼 +debt，回礼 -debt；本身不是“关系好坏”，但调制 trust 更新与对话意愿。
7. reciprocityScore：回礼及时性、对等度累积；违约显著下降。
8. lastChanged（lastInteractionAt）：任意关系更新时刷新为当前 SimTime。
9. dialogueRefs[]：追加 CID，支持 trace 回放。
10. interactionSummary：规则或 LLM 摘要写入，供下次 prompt 与 decay 判断。
11. relationAxis（通常不变）：仅在关系 重新定性 时改（如 stranger→friend）。
12. socialBasis（通常不变）：kinship 确认、结拜等事件可改。
13. interactionRitualScore（扩展）：对话结束 Goffman 仪式链分数写入边。
14. 边是否存在：stranger 首次互动可能 创建 新边（初始化 trust=50 等）。
15. 双向边独立更新：一次互动产生 两条 delta 日志（A→B、B→A）。
16. 更新 clamp 上下界：防止单 slot 暴涨暴跌，保证 180 slot 实验稳定。
17. reason 字段：`dialogue_sentiment | gift_given | gift_replied | gift_defaulted | ritual_norm_fail | decay` 等。
18. formula 字段：记录具体代入值，供实验复现与答辩。
19. before/after 快照：每条 delta 必带，满足 plan 验收。
20. cooperationTendency 与 trust 解耦：工具性礼可只升 trust 不升 cooperationTendency。

### 3.2 关系更新间接修改或触达的组件（至少 20 条）

21. GiftRecord（礼单）：送礼/回礼/违约时 status、replyGid 变更；不直接存 trust，但触发关系更新器。
22. EconomyState.cash：送礼/回礼扣款；经济失败则 不发生 关系正向更新。
23. PublicProfile.reputation：违约、仪式失礼 batch 更新；reputation 进入下次对话 prompt。
24. socialActors.face / prestige：仪式同场比较、host 收礼 batch 更新；影响 StyleProfile 与送礼提案，间接影响关系。
25. BDI.intention：收礼写回礼 I；回礼完成后删除或降级对应 intention。
26. BDI.belief：PET sync 后，“谁欠谁情”“谁不可信”置信度变；不直接写 trust，但改变 plan。
27. BDI.desire：关系大幅变化后可触发 LLM 提案新 desire（如“疏远张三”），经规则 clamp。
28. PET（个人事件表）：事务传播写入；对话若涉及事件则更新 PET → 后续 syncBelief。
29. 总对话表（DialogueRecord）：存 BDIE influence、avgSentiment；关系更新的 输入源。
30. 认知树（四层）：dialogue 层必写；relation 层上呈（“张三值得信赖”）；circle/social 层 MVP 可后置。
31. event_log.jsonl：`relationship.delta`、`gift.*`、`dialogue.end` 追加写。
32. slot 快照 relationships[]：slot 结束全量边状态，供 replay seek。
33. publicMemories：gift_defaulted、仪式失礼、冲突高显著事件；影响第三方关系更新权重。
34. EventInstance 状态：gift 事务 completed/rejected；rejected 则不更新关系。
35. 事务队列 / EventScheduler：决定何时触发绑定对话与礼物 commit。
36. StyleProfile（派生）：不持久独立表时，由 Emotion+人格每对话重算；影响 LLM 输出进而影响下一跳 trust。
37. Emothon：plan 明确 不直接改 trust；仅通过对话行为间接影响。
38. agent 决策候选排序：trust/affection/debt 更新后，改变 `findConversationCandidate` 或 `{attend,gift,chat}` 权重。
39. 制度涌现指标（事后计算）：network_density、clustering、reciprocity_rate、prestige_gini——不写入边，从边与礼单聚合。
40. replay_index / 前端关系图：读 snapshot 与 delta 日志渲染，只读不写。

### 3.3 三条更新通道的对照（plan 核心）

| 通道    | 触发点                               | 主要修改边字段                                                    | 关联组件                                   |
| ----- | --------------------------------- | ---------------------------------------------------------- | -------------------------------------- |
| 对话    | `dialogue.end`                    | trust, affection, intimacy                                 | DialogueRecord, 认知树, PET               |
| 送礼    | `gift.given` commit               | trust, affection, intimacy, giftDebt↑                      | GiftRecord, Economy, BDI.I             |
| 回礼/违约 | `gift.replied` / `gift.defaulted` | trust±, affection±, intimacy±, giftDebt↓, reciprocityScore | GiftRecord, publicMemories, reputation |

# 

## 四、与 `plan.md` 的直接对齐清单

| plan.md 规格                                    | 关系更新规则落点                                          |
| --------------------------------------------- | ------------------------------------------------- |
| 关系边：亲密度、信任、好感、权威                              | intimacy, trust, affection, authority             |
| 补充 giftDebt / reciprocityScore / relationAxis | 礼物通道 + 纵向/横向                                      |
| 对话改 BDIE 与关系边                                 | dialogue.end → 公式 updater                         |
| 送礼增关系；窗口内回礼增、否则降                              | gift.given / replied / defaulted                  |
| LLM 不直接写状态                                    | 仅提案 sentiment/influence；RuleEngine commit         |
| 变更带 before/after/reason                       | relationship.delta 强制字段                           |
| 180 slot × AM/PM/EVE                          | lastChanged、replyWindowEnd、decay 按 slot           |
| 对照实验 E1–E4                                    | memory / reciprocity / vertical / occasion 调制更新路径 |
