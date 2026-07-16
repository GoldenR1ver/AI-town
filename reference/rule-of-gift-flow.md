# 礼物流动规则概括

以下规则综合 阎云翔《礼物的流动》（下岬村：仪式性/工具性礼物、礼单、横向/纵向互惠、欠情—还情、收礼声望、人情道德）与 你的实验设计（关系图、`giftLedger`、`giftDebt`、场合礼、回礼窗口、`face`/`prestige`/`reputation`、RuleEngine 闭环）。可直接作为仿真规则库的理论骨架。

---

## 一、原因方面：礼物流动基于什么社会关系与个人状态？

礼物流动不是随机赠予，而是 关系义务 + 个人资源 + 场合规范 共同驱动的社会行动。

### 1.1 社会关系维度（至少 20 条）

1. 亲属关系（kin）：血缘/姻亲是最高义务强度之一；红白喜事、年节往来中，亲属有默认随礼义务，缺席或不送会被视为断亲或失礼。
2. 邻里关系（neighbor）：同住一社区产生日常互助与仪式出席义务；邻里礼往往金额低于亲属，但 出席本身 很重要。
3. 朋友关系（friend）：基于情感与互惠；礼物既是维系，也是关系“升级/降级”的信号。
4. 同事关系（colleague）：工具性与仪式性并存；办事送礼与职场仪式（婚丧）可能走不同规则。
5. 上级—下级（vertical_up / vertical_down）：纵向关系常 非对称；向上馈赠可单向或象征回礼，向下馈赠不足会损上级 prestige。
6. 横向同辈（horizontal）：同辈间强调 对等互惠；长期价值差过大会触发关系冷却。
7. 实践性亲属：非血缘但被当作“自己人”的关系，义务接近亲属但可略低；仿真中可用 `socialBasis + affection` 复合判定。
8. 弱关系（桥接关系）：工具性送礼常用于 激活或维持弱 tie；礼后不一定立即回，但会留下 `giftDebt`。
9. 关系亲密度（intimacy）：亲密度越高，随礼下限越高、回礼窗口越紧、违约后果越重。
10. 关系信任度（trust）：高信任降低“送礼动机=算计”的解读；低信任时同等礼物可能被读作拉拢或试探。
11. 关系好感度（affection）：好感影响是否 主动送礼；负好感时即使场合义务存在，也可能 Minimal compliance（最低限度应付）。
12. 权威感/正当性（authorityLegitimacy）：A 认为 B 有权威时，更倾向向上送礼；权威边是纵向礼流的重要通道。
13. 合作倾向（cooperationPropensity）：高合作倾向者在公共事务、互助场合更易先送礼/随礼。
14. 既有礼物债务（giftDebt）：B 欠 A 人情时，下一次场合礼、回礼、工具性请求都会受 debt 调制。
15. 互惠历史分（reciprocityScore）：长期互惠良好者，单次礼值偏差容忍度更高；互惠差者，小额礼也会被视为敷衍。
16. 关系轴（relationAxis）：`horizontal | vertical_up | vertical_down` 决定回礼是否必须等额、是否可以象征性回礼。
17. 圈层归属（clique）：同一稳定圈子内，礼物流具有 可见性与比较性；圈外礼更偏工具性、圈內礼更偏仪式性。
18. 公共记忆绑定：若两人曾共同参与高显著仪式/冲突，后续礼物流会带上“旧账”权重（publicMemories.salience）。
19. 角色槽位（RoleSlot）：事务中的 host / guest / kin_of_host 等角色，直接决定是否 必须出席、必须随礼、必须主持回礼。
20. 关系可见性：公开属性中的亲属、职业、住址、社会标签，决定 agent 能否 识别义务对象（PET + 公开 profile）。
21. 非对称边的独立性：A→B 与 B→A 是两条边；礼物流动原因在两侧可以不同（一方出于情，一方出于义务）。
22. 桥接 vs 强连接：强连接靠仪式礼维持；弱连接靠工具性礼 打开通道，之后才可能仪式化。
23. 冲突后的关系修复需求：冲突未修复时，礼物常作为 道歉、示好、重启互惠 的媒介。
24. 权力—人情耦合：在纵向关系中，礼物既是资源转移，也是 等级再确认（下岬村“村民→干部”单向礼）。

### 1.2 个人状态维度（至少 20 条）

25. 经济现金（cash）：决定可送上限；实验设计裁剪为 `[income×0.01, cash×0.3]` 或类似区间。
26. 收入与必要支出比：收入高但必要支出高者，实际礼能力低于账面收入。
27. 存款与负债：高负债者可能 降档随礼 或延迟回礼，引发面子风险。
28. 社会地位/等级（statusRank / prestige）：地位高者 收礼多 常被视为荣誉；地位低者过度送礼可能被读作“攀附”。
29. 面子资本（face）：当前 face 低时，agent 更可能在同场仪式中 加码随礼以争面子。
30. 公共声誉（reputation）：声誉高者缺席仪式的社会代价更大；声誉低者送礼难以快速修复。
31. 遵约倾向（normCompliance）：高者更按时回礼；低者更易违约，除非监控强。
32. BDI 中的 Desire：如“维系关系”“还人情”“争面子”等 desire 优先级，驱动是否发起送礼。
33. BDI 中的 Intention（I）：收礼后系统应写入 回礼计划（对象、窗口、最低金额）；I 是过程层的关键状态。
34. Belief（B）：对“某场合最低礼数”“谁欠谁情”的信念（来自 PET），影响 plan 阶段决策。
35. 情绪：mood / stress：高 stress 可能减少社交性送礼；高 mood 可能增加慷慨随礼。
36. 情绪：energy：energy 低时可能缺席仪式或应付式随礼。
37. 大五人格：高 Agreeableness → 更愿随礼；高 Conscientiousness → 更守回礼窗；高 Extraversion → 更主动出席。
38. SVO（社会价值取向）：亲社会取向高者，公共事务捐赠/随礼更积极。
39. 年龄与生命周期阶段：青年婚礼、中年丧礼、老年寿礼等，不同人生阶段 触发不同礼义务。
40. 职业与收入结构：干部、商人、农民在下岬村语境中礼风不同；仿真可用 occupation 调制 `minGiftNorm`。
41. 教育与社会标签：标签影响 被期待的行为（“有文化的人不该失礼”）。
42. Expressive vs Instrumental 倾向：同一 agent 对不同对象可调整表达性/工具性分数；高表达性礼更看仪式规范，低表达性更看回报预期。
43. 私人记忆（未还礼清单）：`memoryEnabled` 实验组中，记得欠谁情 → 回礼更及时。
44. 公共记忆可见的违约史（sanctionCount）：有违约标签者，后续收礼/受邀概率下降。
45. 互动仪式分（interactionRitualScore）：近期互动质量高，礼物更易被接受为“情分”而非“交易”。
46. Emotional energy（Goffman）：互动能量高者更愿发起礼物事务；能量低者倾向 idle。
47. StyleProfile：由属性推导的说话/决策风格，影响 LLM 提出的礼值提案，但 不直接改世界状态。
48. 认知树—关系层节点：如“张三值得信赖”，会提高对其回礼/随礼的意愿。
49. 时间槽占用（occupancy）：required 事务占用时，无法出席其他仪式 → 构成 缺席原因。
50. 实验配置开关：`memoryEnabled`、`reciprocityEnabled`、是否有 `occasion` 事件，会改变礼物流动的宏观原因结构。

---

## 二、过程方面：礼物流动一般经历什么过程？哪些场景会触发？

### 2.1 一般过程（机制链，至少 20 条）

1. 触发源：scheduled 仪式事务 / agent_driven 意图 / manual 实验注入 / 工具性请求（办事、拉关系）。
2. Observe：agent 读取附近 NPC、未还礼单、即将举行的 occasion、关系类型与 `giftDebt`。
3. Retrieve：从私有记忆 + 礼单摘要 + 公共仪式记忆（PET）取上下文。
4. Plan：LLM 或启发式输出 `{attend, gift, reply, chat, idle}` 及 `{target, giftType, amount, expressiveScore}`。
5. RuleEngine.validate：校验现金、关系类型、场合下限、回礼窗；拒绝则不写状态。
6. 创建 gift 事务（EventInstance）：送礼是 事件，进入事务调度器，而非瞬时 mutation。
7. 强制短对话：送礼前后常绑定对话，用于叙事与 BDIE 提案（情感分、承诺等）。
8. 扣减现金 / 写 giftLedger：`recordGift` 产生 GID、`symbolicValue`、`materialValue`、`status=open`。
9. 更新关系边：trust/affection 初涨；`giftDebt(B→A) += symbolicValue`。
10. 收礼者 Intention 写入回礼方案：在 `replyWindowEnd` 前应 `reply_gift`。
11. 时间推进（timeSlot）：每 slot 执行 `giftWindowCheck`，检查 pending_reply。
12. 回礼过程：`reply_gift` → 新 GiftRecord 关联 `replyGid` → 抵扣 debt → `status=replied`。
13. 窗内足额回礼：trust 加分、`reciprocityScore` 上升、关系强化。
14. 超时或不足回礼：`gift.defaulted` → trust 降、publicMemories 可能写入违约标签。
15. Reflect / eventLog：全链路 `intent → ruleCheck → stateDelta → reason` 必须可追溯。
16. Batch 仪式结算：仪式结束后 batch 更新 host 的 prestige、随礼竞争者的 face。
17. PET 传播：公共仪式事务写入旁观者 PET，扩大“谁送了/谁没送”的可见性。
18. Belief 同步：PET 高置信度信息进入 B，影响后续 plan。
19. 关系衰减 cron：长期无互动 trust 衰减；过期礼单触发违约处理。
20. 非即时对等：回礼可在 不同场合、不同时间 完成；不必同物同值立即返还（Mauss 式立即平衡不适用）。
21. 礼单可查：任意时刻 `query ledger(A,B)`；仪式性礼物常进入公共礼单记忆。
22. 表达性折算：`adjustedValue = value × (1 - expressiveScore%)`；高表达性礼的回礼期待可更低或更延迟（视规则配置）。
23. Multi-hop 人情链：A 送 B，B 欠情；B 的回礼可能发生在 C 的婚礼上给 A——仿真可先简化为直接边。
24. 冲突事务处理：同 slot 仅 `occupancy=required` 互斥；冲突导致缺席是常见过程分支。
25. Agent 闭环：observe → retrieve → plan → commit → reflect；与 Port of Mars / 课程验收对齐。

### 2.2 触发场景（至少 20 条）

26. 婚礼（wedding）：核心仪式性场合；亲属邻里同事均有随礼义务；host prestige 上升。
27. 葬礼（funeral）：义务强度常高于生日；缺席后果更严重。
28. 生日/寿宴（birthday）：礼数可低于婚丧，但仍属 occasion 礼。
29. 年节往来（ritual/festival）：周期性礼物；培养长期关系。
30. 新居落成/乔迁：邻里与亲友出席 + 随礼。
31. 子女升学/满月：生命周期礼；强化亲属与实践性亲属纽带。
32. 疾病探望伴礼：表达性为主，工具性为辅。
33. 感谢帮忙：工具性回礼，可能在正式场合之外发生。
34. 请求办事前“打点”：工具性送礼；事后关系可能淡化或转为 debt。
35. 化解冲突后的和解礼：修复关系、恢复 face。
36. 向上级示好/节日进贡：纵向单向或弱回礼。
37. 公共事务（救灾、修路）捐赠：偏工具性/公共性；影响 reputation 多于 private giftDebt。
38. 同事婚丧职场礼仪：即使私交不深，也常最低限度随礼。
39. “欠情到期”触发回礼：I 中回礼 intention 到期 → agent_driven reply。
40. 同场随礼竞争：多人同场给同一 host，触发 加码（争 face）。
41. 被公开点名/礼单曝光：未送者在公共记忆压力下补送。
42. 经济月初结算后：cash 变化触发新一轮送礼能力评估。
43. 信任骤降事件后：一方送礼求和。
44. 新关系建立（相亲、结拜、认干亲）：初始化高 expressive 礼。
45. 商店/市场关系维护：简化版工具性礼（宴请、小礼）。
46. 收到邀请但无法出席：有时可 人不到礼到；有时两者皆需。
47. 实验注入的 giftOccasion cron：无自然事务时由 scheduled 触发。
48. 对话中 promiseMade：对话标签触发后续送礼 intention。
49. 检测到 `giftLedger.status=open` 且接近 dueAt：系统提醒或 heuristic 优先 reply。
50. 纵向场景：下级晋升、上级退休：单向贺礼/赠礼，回礼规则 asymmetric。

---

## 三、影响方面：不同类型礼物流如何影响 face、prestige 等属性？

### 3.1 面子（face）与荣誉/声望（prestige）是否要区分？

有必要区分。 在你的设计中它们服务不同机制层：

| 维度           | 面子 face                | 荣誉/声望 prestige                         |
| ------------ | ---------------------- | -------------------------------------- |
| 理论来源         | Goffman 互动仪式：情境中的尊严与表现 | 阎云翔：长期社会位置、收礼能力、主持仪式                   |
| 时间性          | 短、情境、可随单场互动涨跌          | 长、累积、跨事件稳定                             |
| 典型触发         | 同场随礼竞争、公开羞辱/尊重、对话礼貌    | 办婚礼收礼、社区地位、纵向礼单                        |
| 可见性          | 当场可见、偏表演               | 社区范围、偏结构位置                             |
| 仿真字段         | `socialActors.face`    | `socialActors.prestige` / `statusRank` |
| 与 reputation | face 像“当前演出分”          | prestige 像“资本/位阶”；reputation 是更综合的公共评价 |

关系：三者可联动但不等同——例如 高额随礼涨 face 但不必然涨 prestige；办大仪式收礼涨 prestige 也涨 face；违约降 reputation，也损 face，prestige 回落更慢。

建议仿真中：face 由互动/同场比较驱动；prestige 由仪式 host、收礼总量、地位边驱动；reputation 作违约/遵约的慢变量。

---

### 3.2 不同类型礼物的影响规则（至少 20 条）

#### A. 仪式性礼物（occasion / 高 expressiveScore）

1. 出席 + 随礼：双方 trust↑、affection↑；缺席且未礼 → trust↓、reputation↓、host 侧可能记 publicMemory。
2. 低于 minGiftNorm：视为失礼 → face↓（送礼者）、关系降；可能写入“小气/不上道”标签。
3. 达到或超过规范礼数：关系维持或强化；同场超额 → face↑（送礼者）。
4. host 收礼累积：prestige↑；礼物越多、参与者越多，声望分化越明显（E4 假设）。
5. 婚丧礼：对 reputation 权重高于生日礼；违约后果更重。
6. 仪式礼的 expressive 高：adjustedValue 低，回礼压力相对小，但 出席义务 更大。
7. 礼单公开：强化 face 竞争与 moral sanction；未登礼单者 social 压力↑。
8. 长期不出席仪式：弱关系断裂、clique 边缘化。

#### B. 工具性礼物（instrumental / 办事礼）

9. 工具性送礼：更易产生 `giftDebt` 与 concrete 回报预期；trust 增幅可能低于仪式礼。
10. 办事成功后：关系可能 暂时升、长期平（B 档“事后关系可淡化”）。
11. 工具性礼失败（事没办成）：trust↓、face↓，且 debt 仍在。
12. 向上工具性礼：prestige（收礼方）↑ 有限；送礼方 face 风险高（被视作攀附）。
13. 高 instrumentalScore：adjustedValue 高 → 回礼窗口内须更足额回礼，否则按违约处理。

#### C. 横向 vs 纵向

14. horizontal 对等回礼：价值差 |Δv| < ε 时 trust 稳定；长期 debt 累积 → 关系冷却。
15. vertical_up（向上）：回礼可少于赠礼或象征性；送礼方 face 可能升（“懂礼数”），prestige 几乎不变。
16. vertical_down（向下）：赠礼不足 → 下级 perceived 失礼；上级 prestige 若依赖布施则受损。
17. 纵向单向流占比：`asymmetric_gift_ratio` 升高 → 权威秩序弱涌现（实验 C 组）。

#### D. 回礼与时序

18. 窗内及时回礼：trust +5（Coleman 规则）；reciprocityScore↑。
19. 延迟但足额回礼：trust 小升；face 中性；reputation 略损。
20. 超时 defaulted：trust -8；reputation↓；publicMemories 违约标签；face↓（若公开）。
21. 回礼不足：按差额继续记 debt；关系降档。
22. 非即时跨场合回礼：允许“欠情—还情”跨事件；prestige 不受影响但 reciprocityScore 记录延迟。

#### E. 对 face / prestige / reputation / trust 等的综合映射

23. 同场多人送礼 host：高额者 face↑↑；host prestige↑（“场面大”）。
24. 公开尊重/礼数到位：Goffman face↑；互动仪式分↑。
25. 公开羞辱/打断/拒收礼：face↓↓；emotionalEnergy↓。
26. 违约被 publicMemory 记录：reputation↓、sanctionCount↑；后续合作 propensity 降。
27. 长期不对等但仍维持：trust 缓慢降但不一定断（B 档不均衡互惠）；prestige 可能稳定若地位高。
28. 收礼多但不回礼（高位者）：在 vertical 语境可合法；在 horizontal 语境严重损 reputation。
29. 礼物带动 weak tie 变 strong：network_density↑、clique 形成；indirect prestige 通过中心性上升。
30. giftDebt 过大：对话/合作概率受调制（debt 调制因子）；stress↑。
31. expressive 与 instrumental 混合礼：分别计算 social 与 material 后果；折算值决定回礼阈值。
32. 经济约束下降档送礼：face 与 reputation 双损；若被理解则 reputation 损幅小。
33. memoryEnabled 组：记得 debt → 回礼及时 → trust/reputation 平均更高（E1）。
34. reciprocityEnabled 组：有 R2–R4 规则 → 网络更稳定、reciprocity_rate 更高（E2）。
35. 无 occasion 组：prestige 分化弱；礼物更工具化、face 波动小（E4 对照）。
36. BDI：收礼后 I 写入回礼：影响后续 slot 行动分布；未写入则系统层违约率升。
37. affection 与 trust 非同步：礼物可只涨 trust 不涨 affection（工具性）；仪式礼两者皆涨。
38. authorityLegitimacy：纵向礼成功 → legitimacy↑；失败 → 权威边弱化。
39. normCompliance 反馈：遵约回礼 → normCompliance↑；形成正反馈。
40. 制度涌现指标：prestige_gini、纵向礼占比、违约后合作恢复曲线——用于事后度量，非单礼物即时属性。

---

## 四、与你实验设计的直接对应（速查）

| 书中/理论概念   | 你的仿真构件                                               |
| --------- | ---------------------------------------------------- |
| 仪式 vs 工具礼 | `expressiveScore` / `instrumentalScore` / `occasion` |
| 礼单        | `giftLedger` + `eventLog`                            |
| 欠情—还情     | `giftDebt` + `replyWindowEnd` + BDI `I`              |
| 横向/纵向     | `relationAxis` + R3/R4                               |
| 收礼荣誉      | `prestige` + 仪式 batch 结算                             |
| 争面子随礼     | `face` + 同场竞争规则 R5                                   |
| 人情道德      | `gift.defaulted` + `publicMemories`                  |
| 对照实验      | E1 记忆 / E2 互惠规则 / E3 纵向 / E4 场合                      |
