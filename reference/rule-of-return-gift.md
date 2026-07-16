# 回礼违约影响规则设计

以下设计对齐 `plan.md` 的礼物闭环（`giftWindowCheck`、折算价值、`giftDebt`、BDI 回礼 `I`）、阎云翔 「欠情—还情的时间性」 与 「人情道德性」，以及你提出的 按礼物性质区分回礼窗口（含无限长=无需回礼）。

---

## 一、设计原则（与 `plan.md` 对齐）

1. 违约判定只由 RuleEngine 执行：每 `timeSlot` 的 `giftWindowCheck` 扫描 `status=pending_reply` 且 `now > replyWindowEnd` 的记录。
2. 两类违约：
   - 超时违约（defaulted_timeout）：窗口内完全未回礼；
   - 不足违约（defaulted_underpay）：窗口内回礼但 `replyValue < requiredReplyValue`。
3. 应回数额（横向基准）：

requiredReplyValue = adjustedValue

= gift.value × (1 − expressiveScore)

纵向关系另乘 `relationAxis` 系数（见下文）。 4. 所有状态变更写 `gift.defaulted` + `relationship.delta`，带 `before/after/reason`。 5. LLM 不判违约；只可在对话中提案 BDIE，由规则 clamp。

---

## 二、礼物性质与回礼窗口（`replyWindow`）

建议为每类礼物配置 `replyPolicy`：

| 礼物类型          | expressive | instrumental | 默认窗口（slot）              | 是否需回礼    | 理论依据                    |
| ------------- | ---------- | ------------ | ----------------------- | -------- | ----------------------- |
| 仪式性场合礼（婚/丧/寿） | 0.85–0.95  | 0.05–0.15    | 长窗：90–180 slot（约 1–2 月） | 是，可跨场合   | 阎云翔：非即时对等，跨事件还情         |
| 年节往来礼         | 0.70–0.85  | 0.15–0.30    | 中长窗：45–90 slot          | 是        | 周期性互惠                   |
| 日常表达礼（探望、贺喜）  | 0.60–0.75  | 0.25–0.40    | 中窗：21–45 slot           | 是        | 情分礼，期待较弱回礼              |
| 工具性办事礼        | 0.10–0.30  | 0.70–0.90    | 短窗：9–21 slot            | 是，且要求高足额 | 工具性：回报预期明确              |
| 紧急互助礼（救灾、救急）  | 0.40–0.60  | 0.40–0.60    | 短窗：6–15 slot            | 是        | 义务强、时效高                 |
| 象征性心意礼        | 0.90+      | <0.10        | 超长窗：180+ slot 或「下次场合抵」  | 弱义务      | 高表达性 → adjustedValue 极低 |
| 纵向向上礼（下级→上级）  | 任意         | 任意           | ∞（无窗口）                  | 否        | R4：单向馈送合法               |
| 纵向向下赏礼（上级→下级） | 0.50+      | <0.50        | ∞ 或超长窗                  | 否/弱      | 布施型，不期待对等回礼             |
| 公共捐赠礼         | 0.30       | 0.70         | ∞                       | 否        | 偏 reputation，不进双边 debt  |
| 婚礼 host 收礼    | 高          | 低            | 收礼方 不回给每位宾客             | 否（对单个宾客） | 收礼增 prestige，非一对一债      |

窗口计算示例（180 slot ≈ 60 天）：

replyWindowEnd = givenAt + baseWindow(giftType)

× intimacyModifier

× relationAxisModifier

intimacyModifier: 亲密度高 → 窗口略短（期待更及时）

relationAxisModifier:

horizontal: 1.0

vertical_up: ∞（设 replyRequired=false）

vertical_down: 1.5（可更宽容）

规则 W1–W10（窗口层）

- W1：仅 `replyRequired=true` 的礼物进入 `pending_reply`；`replyRequired=false` 直接 `status=closed`，不产生违约。
- W2：`expressiveScore ≥ 0.8` 时，`adjustedValue` 下调，窗口自动延长（表达性越高，金钱回礼压力越小、时间可越长）。
- W3：`instrumentalScore ≥ 0.7` 时，窗口缩短，且 `requiredReplyValue` 上浮 10–20%。
- W4：婚丧礼允许 跨 occasion 回礼（在窗口内任何场合送给原赠礼者即算抵扣）。
- W5：年节礼若在窗口内已发生 反向年节礼，可按 `min(双方礼值)` 抵扣 debt。
- W6：纵向向上礼（`vertical_up`）永不触发 `giftWindowCheck` 违约。
- W7：纵向向下礼违约 主要损 prestige（收礼方/上级），而非 trust（若下级未领情）。
- W8：公共捐赠不写 `giftDebt(B→A)`，违约规则不适用；仅影响 `reputation`。
- W9：窗口临近结束（剩余 ≤3 slot）时，向收礼者 BDI `I` 注入高优先级 `reply_gift` 提醒（非强制，但提高 plan 权重）。
- W10：经济月初结算后若 `cash` 不足，允许 申请一次窗口延长（+9 slot，每礼单限 1 次），否则视为客观违约，惩罚减半。

---

## 三、违约严重度分级

在应用惩罚前，先算 `defaultSeverity ∈ [0,1]`：

severity = w1 × timeoutFactor

+ w2 × underpayRatio

+ w3 × visibilityFactor

+ w4 × repeatFactor

+ w5 × giftTypeWeight

timeoutFactor: 完全未回=1.0；不足回=underpayRatio

underpayRatio: 1 − replyValue/requiredReplyValue

visibilityFactor: 公共仪式礼单=1.0；私下=0.4

repeatFactor: 12个月内第n次违约 → min(1, 0.3×n)

giftTypeWeight: 婚丧=1.0；工具=0.9；日常=0.6；象征=0.3

规则 S1–S5（严重度层）

- S1：`severity < 0.3` → 轻度违约（lapse），仅关系微调，不写 publicMemory。
- S2：`0.3 ≤ severity < 0.6` → 中度违约，写 private memory + 关系显著下降。
- S3：`severity ≥ 0.6` → 重度违约，写 `publicMemories`（salience 高）+ reputation 显著下降。
- S4：同一场合公开礼单上的不足回礼，severity 自动 +0.2。
- S5：违约后 `giftDebt` 不自动清零，剩余债务继续累积，影响后续合作概率。

---

## 四、回礼违约影响规则（≥20 条，按维度）

### A. 关系边（有向边 B→A，B 为违约方）

R1. 信任 trust

- 超时：`trust -= 8 × severity`（基准对齐 Coleman 规则）
- 不足：`trust -= 5 × severity`
- 纵向向上礼：不适用

R2. 好感 affection

- 违约比 trust 更伤情感：`affection -= 10 × severity`
- 若双方原 `affection > 60`（好友），额外 -3（「辜负情分」）

R3. 亲密度 intimacy

- 缓慢下降：`intimacy -= 6 × severity`
- 连续 2 次中度以上违约：额外 `intimacy -= 10`

R4. 互惠分 reciprocityScore

- `reciprocityScore -= 15 × severity`（下限 0）
- 窗内足额回礼时 +10，形成鲜明对比

R5. 礼物债务 giftDebt

- 超时：`giftDebt(B→A)` 保持全额，且 `symbolicValue × 1.1` 惩罚性记帐
- 不足：剩余 `requiredReplyValue - replyValue` 继续挂账

R6. 合作倾向 cooperationPropensity

- `cooperationPropensity -= 0.15 × severity`（B 作为伙伴的可靠性下降）
- A 对 B 的边：`cooperationPropensity -= 0.10 × severity`

R7. 权威正当性 authorityLegitimacy

- 若 B 曾为 A 的 `vertical_down` 对象（B 是上级），违约损 A 对 B 的 legitimacy（「失德的长者」）
- 若 B 是 `vertical_up` 下级，对上级不回礼通常 不损 trust（单向礼）

R8. 互动仪式分 interactionRitualScore

- 违约后下一次对话的 ritual 基线 -20；对话中易出现尴尬、冷淡标签

R9. 反向边非对称

- A→B 的 trust 降幅可为 B→A 的 50–70%（被违约方愤怒 > 连带失望）

R10. 关系基础 socialBasis 调制

- `kin`：违约惩罚 ×1.3
- `friend`：×1.2
- `colleague`：×1.0
- `neighbor`：×0.9
- `weak_tie`：×0.7（关系本就浅，断了代价小）

---

### B. 个体公开/私人属性

R11. 面子 face（违约方 B）

- 公开礼单违约：`face -= 12 × severity`
- 私下违约：`face -= 4 × severity`
- 被赠礼方 A 当众提及/抱怨：B 的 `face` 再 -5

R12. 面子 face（受害方 A）

- 通常不扣；但若 A 曾对外吹嘘 B 会回礼，则 A 的 `face -= 3 × severity`（连带丢脸）

R13. 荣誉 prestige（违约方 B）

- .prestige 是慢变量：单次轻度违约不动；`severity ≥ 0.6` 时 `prestige -= 5 × severity`
- 若 B 是 recent occasion host，违约会抵消此前收礼带来的 prestige 增益的 30%

R14. 公共声誉 reputation

- `reputation -= 8 × severity`；写入 `sanctionCount += 1`
- 重复违约：`reputation` 衰减加速（每次 ×1.2 叠加）

R15. 遵约倾向 normCompliance

- 违约方 B：`normCompliance -= 0.08 × severity`（长期行为参数）
- 观察者在 PET 中记录后，对 B 的初始 trust 在新关系中 -5

R16. 情绪 Emotion（违约方 B）

- `stress += 15 × severity`
- `mood` 下降（映射为负向）
- `energy` 略降（社交回避）

R17. 情绪 Emotion（受害方 A）

- `stress += 8 × severity`
- `mood` 下降；高 Neuroticism 个体加倍

R18. BDI — Intention

- 违约发生后，清除 B 原 `reply_gift` intention；
- 注入 A 的 `confront` / `distance` / `demand_repay` 低优先级 intention（依 personality）

R19. BDI — Belief

- A 的 Belief 更新：`"B 不可靠"` 置信度 +0.3 × severity
- 经 PET 传播后，共同熟人置信度 +0.1 × severity

R20. BDI — Desire

- A 的 `desire.maintain_relationship(B)` 优先级下降；
- B 的 `desire.repair_relationship(A)` 在 `normCompliance` 高者上升

---

### C. 网络、记忆与行为后果

R21. 公共记忆 publicMemories

- `severity ≥ 0.6`：写入 `{eventType:'gift', title:'回礼违约', participants:[A,B], salience: 60+}`
- 婚丧场合违约：salience +20

R22. PET 传播

- 公共仪式违约 → 在场者 PET 写入「B 对 A 失信」；置信度随关系距离衰减

R23. 对话触发概率

- 违约后 A 主动找 B 对话概率 ×0.5；B 主动修复概率 ×1.3（高 Agreeableness）

R24. 后续送礼/受邀

- A 邀请 B 出席仪式的权重 -30%；B 对 A 的随礼下限心理值 +10%（补救心态）

R25. 部分补救（grace period）

- 违约后 9 slot 内 足额补礼：`trust` 恢复 50%，`face` 恢复 40%，`publicMemory` 标为「已补救」
- `giftDebt` 按实额抵扣，但 `reciprocityScore` 仍留污点（只恢复一半）

R26. 不足回礼 vs 完全不回

- 不足回礼：关系惩罚约为完全不回的 60–70%
- 但工具性礼物不足回礼时，A 更可能视为 故意敷衍，severity +0.15

R27. 经济约束免责

- 若 `cash < income×0.05` 且 `debt` 高，severity ×0.5；`reputation` 仍小幅下降（「情有可原，但仍失礼」）

R28. 纵向关系特例

- `horizontal`：全额适用上述规则
- `vertical_up`（B 收上级礼）：不违约
- `vertical_down`（B 收下级礼却不回赏/不回情）：损 B 的 `prestige`，不损 `trust` 或轻损

R29. 表达性极高礼（expressive ≥ 0.9）

- 超时违约主要伤 `affection` 和 `face`，`trust` 惩罚减半
- 社会解读偏「忘了情分」而非「赖账」

R30. 工具性极高礼（instrumental ≥ 0.8）

- 超时违约主要伤 `trust` 和 `reputation`，`affection` 惩罚加重
- 社会解读偏「过河拆桥」

R31. 集群效应

- 同一 clique 内 3+ 人知晓违约 → B 在该 clique 所有边的 `trust` 额外 -2（口碑扩散）

R32. 实验可观测指标

- `gift_default_rate`、`avg_repay_delay`、`trust_delta_mean`、`prestige_gini`、违约后 30 slot 合作恢复率