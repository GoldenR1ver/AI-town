# 礼物的流动 — Gift Flow Sim

基于阎云翔《礼物的流动》的 **多智能体社会学仿真**。系统已完成开发，可本地跑通演示、批跑实验与像素回放。

核心链路：

```
事务触发 → 对话叙事 → RuleEngine 改关系 / 经济 / 礼物 → JSONL + 快照 → 像素步进回放
```

仓库：[GoldenR1ver/AI-town](https://github.com/GoldenR1ver/AI-town)

---

## 项目状态

仿真引擎、规则结算、对照 / 消融实验、指标分析与像素回放前端均已可用。默认 **mock 对话**，不消耗 API；配置 OpenAI 兼容接口后可切到 live LLM（已验证 DeepSeek）。

| 能力 | 说明 |
| --- | --- |
| 机制 Demo | 16 人村庄，约 5 天叙事，可直接打开回放 UI |
| 对齐短跑 | 100 人 × 30 天 mock，机制标定 |
| 主实验 | 100 人 × 365 天 live，假说检验与复跑 |
| 对照 / 消融 | E1–E4 规则对照；A0–A3 架构消融 |
| 可视化 | React + PixiJS 像素村庄，步进回放对话、关系、BDIE |

主跑（100 Agents · 365 天 · DeepSeek · seed=42）关键结果：互惠率 **0.90**，违约率 **0.022**，平均回礼延迟 **~17 slots**，礼物—声望相关 **0.51**，礼物—财富相关 **0.07**。

---

## 5 分钟上手

**环境**：Node.js **≥ 20**（建议 22 LTS）

```bash
git clone https://github.com/GoldenR1ver/AI-town.git
cd AI-town
npm install
```

### 只看回放（推荐）

```bash
npm run demo
npm run frontend:serve
# 浏览器打开 http://127.0.0.1:5177/
```

`demo` 会跑一场约 5 天的 mock 剧情，导出 `replay_data.json` 并构建前端。

**回放操作**：`Space` / `→` 下一步 · `←` 上一步 · 时间轴 / 滑杆跳转 · 点击角色或关系图节点查看 BDIE。

### 改规则 / 后端后再回放

```bash
npm run sim:demo          # 生成 run 到 sim/data/runs/<runId>/
npm run verify:frontend   # 校验语义 steps 与 checkpoint 重建
npm run frontend:export
npm run frontend:dev      # Vite 热更新 http://127.0.0.1:5177/
```

### 跑一轮标准实验

```bash
npm run sim:run -- --preset baseline_16_30d
```

---

## 系统在做什么

村庄里的每个 Agent 有职业、经济、BigFive 性格、BDIE（信念 / 欲望 / 意图 / 情绪）和主观记忆。公共事务、社交拜访与回礼窗口会触发互动；LLM 只产出话语与意图提案，**世界状态只能经 RuleEngine 写入**。礼单账本维护送 / 还 / 违约与回礼窗口（W4–W10），用来检验阎云翔式人情模式：延迟互惠、纵向不对称、声望吸引、互惠中态。

```
事件生成（公共事务 / 社交驱动 / 回礼驱动）
    → [可选] LLM 对话（受个人状态叙事约束）
    → PET 更新 + 认知树归档
    → BDIE 驱动偏好与拒绝
    → 送礼 / 回礼提案
    → RuleEngine 唯一写世界（现金、关系、面子、礼单）
    → 日志 + 快照 → 像素回放
```

设计原则：

1. LLM 只产出文本与意图提案，**不直接写**世界状态。
2. 所有状态变更经 `RuleEngine`，写入 append-only 日志（含 `before/after/reason`）。
3. 前端只读日志与快照；JSONL / Snapshot 为唯一回放真理源。

---

## 仓库结构

```
.
├── sim/
│   ├── backend/                 # 仿真引擎
│   │   ├── engine/              # 实验入口、调度、导出、分析、verify
│   │   ├── rules/               # RuleEngine（唯一状态变更闸门）
│   │   ├── systems/             # event / dialogue / gift / relationship / economy / person
│   │   ├── cognition/           # BDIE、认知树、性格派生、决策
│   │   ├── store/               # WorldState、ReplayEngine、快照
│   │   └── llm/                 # OpenAI 兼容 LLM 客户端（mock / live）
│   ├── frontend/
│   │   ├── game/                # React + Vite + PixiJS 像素回放（主前端）
│   │   ├── replay/              # 旧版静态回放（参考）
│   │   └── serve.ts             # 静态服务器 → dist/
│   ├── shared/
│   │   ├── types/               # 数据契约
│   │   └── replay/              # 语义 steps、日志 reducer
│   └── data/
│       ├── agents.json          # 16 人村庄初始人设
│       ├── agents_100.json      # 100 人规模数据
│       ├── event_templates/     # 事务模板
│       ├── experiment_params/   # JSON 实验预设
│       └── runs/                # 实验产物（各 run 目录 git 忽略）
├── reference/                   # 规格、结题报告、计划板
├── ppt/                         # 汇报材料
└── package.json
```

---

## 常用命令

### 仿真

| 命令 | 用途 |
| --- | --- |
| `npm run demo` | **推荐入门**：5 天 mock demo → 导出 → 构建前端 |
| `npm run sim:demo` | 只生成 demo run，不构建前端 |
| `npm run sim:empty` | 空跑时钟，验证 JSONL / 快照管线 |
| `npm run sim:run -- --preset baseline_16_30d` | 16 人 × 30 天 mock（默认基线） |
| `npm run sim:run:tune30` | 100 人 × 30 天对齐短跑 |
| `npm run sim:run:final365` | 100 人 × 365 天 live 主实验 |
| `npm run sim:contrast` | E1–E4 规则对照 |
| `npm run sim:ablation` | A0–A3 架构消融 |

可用预设见 [`sim/data/experiment_params/README.md`](./sim/data/experiment_params/README.md)。环境变量可覆盖 `RUN_ID` / `SEED` / `DAYS` / `VARIANT` 等。

### 前端回放

| 命令 | 用途 |
| --- | --- |
| `npm run frontend:export` | 从 run 生成 `game/public/replay_data.json` |
| `npm run frontend:dev` | 前端热更新，http://127.0.0.1:5177/ |
| `npm run frontend:build` | 构建到 `sim/frontend/dist/` |
| `npm run frontend:serve` | 服务 dist |
| `npm run frontend:start` | export + build + serve |

指定 run 导出（PowerShell）：

```powershell
$env:RUN_ID = "demo_1784110806538"
npm run frontend:export
```

### 分析

| 命令 | 用途 |
| --- | --- |
| `npm run analyze:stratification` | 声望 / 财富分层与收礼相关 |
| `npm run analyze:discourse` | 话语与状态对齐 |
| `npm run analyze:convergence` | 指标收敛 |
| `npm run analyze:final365` | 主跑汇总 |

### 验收

```bash
npm run typecheck
npm run verify:frontend   # 语义 steps + checkpoint 重建
npm run verify:p0         # 契约 / 空跑 / 模板库
npm run verify:p1         # 事务管线 + PET/BDI + 送礼
npm run verify:p2         # 对话多模式 / 摘要 / BDIE
npm run verify:p3         # 关系三通道 / 认知树
npm run verify:p4         # 经济礼物闭环 / 场合规范
npm run verify:p5         # 主时钟串联 / 批跑 / 指标
npm run verify:systems    # 九层核心系统汇总
```

---

## LLM 真机配置

默认 **mock**，不消耗 API。live 模式需要 OpenAI 兼容接口（已验证 DeepSeek）。**不要提交真实密钥。**

PowerShell：

```powershell
$env:AGENTSOCIETY_LLM_API_BASE = "https://api.deepseek.com/v1"
$env:AGENTSOCIETY_LLM_API_KEY  = "你的 Key"
$env:AGENTSOCIETY_LLM_MODEL     = "deepseek-chat"
$env:LLM_MODE = "live"
npm run llm:ping
```

| 场景 | 环境变量 |
| --- | --- |
| 叙事 demo | `DEMO_LLM_MODE=live` |
| 标准批跑 | `P5_LLM_MODE=live` |
| 365 天主跑 | 使用 `--preset final_align_100_365d`（预设已为 live） |

`API_BASE` 只写到 `/v1`，不要带 `/chat/completions`。实现见 `sim/backend/llm/client.ts`。

365 天真机批跑示例：

```powershell
$env:P5_LLM_MODE = "live"
$env:DAYS = "365"
$env:VARIANT = "baseline"
$env:SEED = "42"
$env:RUN_ID = "deepseek_365d_$(Get-Date -Format 'yyyyMMdd_HHmm')"
npm run sim:run
```

---

## 实验产物（`sim/data/runs/`）

每次仿真落在 `sim/data/runs/<runId>/`：

| 文件 | 含义 |
| --- | --- |
| `event_log.jsonl` | 追加式因果日志（真理源之一） |
| `snapshots/D{n}-{AM\|PM\|EVE}.json` | 每 slot 世界快照（真理源之二） |
| `conversation_table.jsonl` | 对话全文 |
| `metrics.json` | 汇总指标 |
| `config.json` | 当次 run 配置（含 llmMode、variant） |
| `LATEST_*_RUN.txt` | 指针，标记最新一类实验 |

`runs/*/` 默认 **不提交 git**。clone 后需本地跑 `npm run demo` 或 `npm run sim:run` 生成。共享同一份 run 时，传整个 `<runId>` 文件夹即可。

---

## 像素回放

- 源码：`sim/frontend/game/src/`
- 数据包：`sim/frontend/game/public/replay_data.json`（由 `frontend:export` 生成）
- 离线回放：`steps[]` 语义步进 + slot checkpoint 校准；不推进仿真
- 面板：事件时间轴、对话、关系图、声望榜、BDIE Inspector、角色聚焦
- 素材：复用 [AI-town](https://github.com/a16z-infra/ai-town) 像素地图与角色；许可见 `sim/frontend/game/public/AI_TOWN_LICENSE.txt`

---

## 常见问题

**Q: clone 后打开回放是空的？**  
先 `npm run demo`，或指定 `RUN_ID` 后执行 `frontend:export`，再 `frontend:serve`。

**Q: `frontend:export` 用了错误的 run？**  
设置 `$env:RUN_ID="<runId>"`，或查看 `sim/data/runs/LATEST_DEMO_RUN.txt`。

**Q: 改前端样式不生效？**  
开发用 `frontend:dev`；预览构建结果用 `frontend:build` + `frontend:serve`。

**Q: typecheck 过了但前端报错？**  
另跑 `npx tsc -p sim/frontend/game/tsconfig.json --noEmit`。

**Q: 推送 git 很大 / 很慢？**  
检查是否误加 `node_modules`、`sim/data/runs/*/`、体积很大的 `replay_data.json`。

---

## 延伸阅读

| 文档 | 内容 |
| --- | --- |
| [`工程介绍.md`](./工程介绍.md) | 简历可用的项目介绍与要点 |
| [`reference/结题报告-礼物流动多智能体仿真.md`](./reference/结题报告-礼物流动多智能体仿真.md) | 假说、组件、主跑结果 |
| [`reference/汇报大纲-礼物流动多智能体仿真.md`](./reference/汇报大纲-礼物流动多智能体仿真.md) | 汇报结构 |
| [`sim/data/experiment_params/README.md`](./sim/data/experiment_params/README.md) | 实验预设 |
| [`sim/data/runs/README.md`](./sim/data/runs/README.md) | run 目录结构 |
| [`reference/project-plan-board.md`](./reference/project-plan-board.md) | Phase 0–6 开发计划（历史） |
