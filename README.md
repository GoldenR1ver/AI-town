# 礼物的流动 — Gift Flow Sim

基于阎云翔《礼物的流动》的 **multi-agent 社会学仿真**。  
核心链路：`事务触发 → 对话叙事 → RuleEngine 改关系/经济/礼物 → JSONL/快照 → 像素步进回放`。

> 仓库：[GoldenR1ver/AI-town](https://github.com/GoldenR1ver/AI-town)

---

## 新人 5 分钟上手

**环境**：Node.js **≥ 20**（建议 22 LTS）

```bash
git clone https://github.com/GoldenR1ver/AI-town.git
cd AI-town
npm install
npm run typecheck
```

### 路径 A — 只看回放 UI（不改后端）

```bash
npm run demo
npm run frontend:serve
# 浏览器打开 http://127.0.0.1:5177/
```

`demo` 会：跑一场约 5 天的 mock 剧情 → 导出 `replay_data.json` → 构建前端。

### 路径 B — 改后端 / 规则 / 对话

```bash
npm run sim:demo          # 生成 run 到 sim/data/runs/<runId>/
npm run verify:frontend   # 校验语义 steps 与 checkpoint 重建
npm run typecheck
```

### 路径 C — 改像素前端

```bash
npm run frontend:export   # 需要已有 run；默认读 LATEST_DEMO_RUN.txt
npm run frontend:dev      # Vite 热更新 http://127.0.0.1:5177/
```

**回放操作**：`Space`/`→` 下一步 · `←` 上一步 · 时间轴/滑杆跳转 · 点击角色/关系图节点查看 BDIE。

---

## 双人协作怎么分工

项目按 **引擎（A）** 与 **契约/演示（B）** 两条线并行，减少改同一文件的冲突。

| 代号 | 主要负责 | 常改目录 |
| --- | --- | --- |
| **A** | 时钟、RuleEngine、事务、对话、经济/礼物规则、BDI | `sim/backend/rules/`、`sim/backend/systems/`、`sim/backend/cognition/`、`sim/backend/engine/experiment.ts` |
| **B** | 日志/快照、Replay、导出器、像素前端、批跑指标 | `sim/shared/`、`sim/backend/store/`、`sim/backend/engine/export_demo_data.ts`、`sim/backend/engine/frontend_replay_data.ts`、`sim/frontend/game/` |

**协作约定**

1. **Schema 变更**（`sim/shared/types/`）需两人确认后再合入 `main`。
2. **状态只能经 RuleEngine 写入**；LLM 只产出文本/提案，禁止直接改 `WorldState`。
3. **前端只读** `event_log.jsonl` + snapshot，不依赖后端私有内存。
4. 大改前先跑相关 `verify:*`；合入 `main` 前至少：`npm run typecheck` + 与你改动相关的 verify。

详细任务板：[`reference/project-plan-board.md`](./reference/project-plan-board.md)

---

## 仓库结构

```
.
├── sim/
│   ├── backend/                 # 仿真引擎
│   │   ├── engine/              # 实验入口、调度、导出、verify 脚本
│   │   ├── rules/               # RuleEngine（唯一状态变更闸门）
│   │   ├── systems/             # event / dialogue / gift / relationship / economy / person
│   │   ├── cognition/           # BDI、认知树
│   │   ├── store/               # WorldState、ReplayEngine、快照
│   │   └── llm/                 # OpenAI 兼容 LLM 客户端
│   ├── frontend/
│   │   ├── game/                # React + Vite + PixiJS 像素回放（主前端）
│   │   ├── replay/              # 旧版静态回放（保留参考）
│   │   ├── dist/                # 构建产物（git 忽略，本地生成）
│   │   └── serve.ts             # 静态服务器 → dist/
│   ├── shared/
│   │   ├── types/               # 冻结数据契约（改字段先沟通）
│   │   └── replay/              # 语义 steps、日志 reducer、回放类型
│   └── data/
│       ├── agents.json          # 16 人村庄初始人设
│       ├── relationships.json
│       ├── event_templates/     # 事务模板
│       └── runs/                # 实验产物（各 run 目录 git 忽略）
├── reference/                   # 计划板与规格
├── package.json
└── .env.example                 # LLM 配置模板（勿提交真实 .env）
```

---

## 实验产物说明（`sim/data/runs/`）

每次仿真会在 `sim/data/runs/<runId>/` 落盘：

| 文件 | 含义 |
| --- | --- |
| `event_log.jsonl` | 追加式因果日志（真理源之一） |
| `snapshots/D{n}-{AM\|PM\|EVE}.json` | 每 slot 世界快照（真理源之二） |
| `conversation_table.jsonl` | 对话全文 |
| `metrics.json` | 汇总指标 |
| `config.json` | 当次 run 配置（含 llmMode、variant） |
| `LATEST_*_RUN.txt` | 指针文件，标记「最新一次某类实验」 |

**注意**：`runs/*/` 目录默认 **不提交 git**（体积大）。clone 后需本地跑 `sim:demo` 或 `sim:run` 生成。  
若两人要共享同一份 run，用网盘/Release 传整个 `<runId>` 文件夹，或只传小型 demo run。

---

## 常用命令速查

### 仿真

| 命令 | 用途 |
| --- | --- |
| `npm run sim:empty` | 空跑时钟，验证 JSONL/快照管线 |
| `npm run sim:demo` | **推荐入门**：5 天叙事 demo（mock 对话） |
| `npm run sim:run` | P5 批跑，默认 30 天；`DAYS=60` 可加长 |
| `npm run sim:contrast` | E1–E4 对照实验并导出指标 |

### 前端回放

| 命令 | 用途 |
| --- | --- |
| `npm run frontend:export` | 从 run 生成 `game/public/replay_data.json` |
| `npm run frontend:dev` | 前端热更新开发 |
| `npm run frontend:build` | 构建到 `sim/frontend/dist/` |
| `npm run frontend:serve` | 服务 dist，http://127.0.0.1:5177/ |
| `npm run frontend:start` | export + build + serve 一键 |
| `npm run demo` | sim:demo + export + build |

指定 run 导出（PowerShell）：

```powershell
$env:RUN_ID = "demo_1784110806538"
npm run frontend:export
```

### 验收 / 质量

| 命令 | 覆盖 |
| --- | --- |
| `npm run typecheck` | 后端 TypeScript |
| `npm run verify:frontend` | 语义 steps 顺序、对话唯一性、checkpoint 重建 |
| `npm run verify:p0` … `verify:p5` | 各 Phase 回归（见下方） |

---

## LLM 真机配置

默认 **mock** 对话，不消耗 API。真机需 OpenAI 兼容接口（已验证 DeepSeek）。

复制 `.env.example` 为本地备忘，**不要提交 `.env`**：

```powershell
$env:AGENTSOCIETY_LLM_API_BASE = "https://api.deepseek.com/v1"
$env:AGENTSOCIETY_LLM_API_KEY  = "你的 Key"
$env:AGENTSOCIETY_LLM_MODEL     = "deepseek-chat"
$env:LLM_MODE = "live"
npm run llm:ping
```

| 场景 | 环境变量 |
| --- | --- |
| P5 批跑 60 天 | `P5_LLM_MODE=live` + `DAYS=60` |
| 叙事 demo | `DEMO_LLM_MODE=live` |
| P2 对话实验 | `P2_LLM_MODE=live` |

`API_BASE` 只写到 `/v1`，不要带 `/chat/completions`。实现见 `sim/backend/llm/client.ts`。

<<<<<<< Updated upstream
```bash
npm run verify:p0     # Phase 0：契约/空跑/Replay/模板库
npm run verify:systems # 九层核心系统：静态契约 + runtime 汇总验收
npm run verify:p1     # Phase 1：事务管线 + PET/BDI + 经事件送礼
npm run verify:p2     # Phase 2：Prompt/多模式对话/摘要/BDIE/持久化
npm run verify:p3     # Phase 3：关系三通道/认知树/R5
npm run verify:p4     # Phase 4：R1/R3/R4/R6/R7 + 策略提案 + 表达/工具礼
npm run verify:p5     # Phase 5：主时钟串联 + 批跑/指标/Inspector
npm run sim:run       # P5 集成批跑（默认 30 天；DAYS=60 可加长）
npm run sim:contrast  # E1/E2 对照并导出 CSV/JSON
npm run sim:p1        # 跑 P1 实验（婚礼 scheduled + 工具礼 + 回礼）
npm run sim:p2        # mock 对话实验（默认）
npm run sim:p4        # P4 经济/礼物闭环实验（默认 mock）
npm run verify:d1     # 兼容旧 D1 空跑验收
npm run verify:d2     # 兼容旧 D2 礼单规则验收
npm run verify:frontend # 语义 steps + checkpoint reducer 验证
npm run frontend:start  # 导出 + 构建 + 静态服务，http://127.0.0.1:5177/
```

P1 抽查：log 含 `event.created/propagated/completed`、`bdi.updated`、`gift.given`；snapshot 中 PET 与 `beliefs["event:…"]` 非空。

P2 live 模式：
=======
### 60 天真机批跑示例
>>>>>>> Stashed changes

```powershell
$env:P5_LLM_MODE = "live"
$env:DAYS = "60"
$env:VARIANT = "baseline"
$env:SEED = "42"
$env:RUN_ID = "deepseek_60d_$(Get-Date -Format 'yyyyMMdd_HHmm')"
npm run sim:run
```

---

## 开发工作流（两人并行）

```bash
git checkout main
git pull
git checkout -b feat/your-topic    # 或 fix/、docs/

# 开发 …
npm run typecheck
npm run verify:frontend              # 若动了导出/reducer/前端数据
# npm run verify:p4 等              # 若动了对应子系统

git add <files>
git commit -m "feat: 简述改动原因"
git push origin feat/your-topic
# 在 GitHub 提 PR，互相 review 后合并
```

**不要提交**：`.env`、`node_modules/`、`sim/data/runs/<runId>/`、本地 `sim/frontend/dist/`。  
`replay_data.json` 为导出产物，clone 后执行 `frontend:export` 即可生成。

**减少冲突的建议**

- A 改 `sim/backend/systems/*`、`rules/*` 时，B 尽量改 `sim/frontend/game/*` 或 `sim/shared/replay/*`。
- 动 `sim/shared/types/index.ts` 前先同步一声。
- 各自 long run 放本地 `runs/`，不要往仓库塞几百 MB 快照。

---

## 像素回放前端说明

- 源码：`sim/frontend/game/src/`
- 数据包：`sim/frontend/game/public/replay_data.json`（由 `frontend:export` 生成）
- 离线回放：`steps[]` 语义步进 + slot checkpoint 校准；不连 Convex、不推进仿真
- 素材：复用 [AI-town](https://github.com/a16z-infra/ai-town) 像素地图与角色；许可见 `game/public/AI_TOWN_LICENSE.txt`

---

## Phase 验收（回归清单）

```bash
npm run verify:p0     # 契约 / 空跑 / Replay / 模板库
npm run verify:p1     # 事务管线 + PET/BDI + 送礼
npm run verify:p2     # 对话多模式 / 摘要 / BDIE
npm run verify:p3     # 关系三通道 / 认知树
npm run verify:p4     # 经济礼物闭环 / 场合规范
npm run verify:p5     # 主时钟串联 / 批跑 / 指标
npm run verify:frontend
```

---

## 设计原则（勿破）

1. LLM 只产出文本与意图提案，**不直接写**世界状态。
2. 所有状态变更经 `RuleEngine`，写入 append-only 日志（含 `before/after/reason`）。
3. 前端只读日志与快照；Env JSONL / Snapshot 为唯一回放真理源。

---

## 常见问题

**Q: clone 后打开回放是空的？**  
先 `npm run demo` 或指定 `RUN_ID` 后 `npm run frontend:export`，再 `frontend:serve`。

**Q: `frontend:export` 用了错误的 run？**  
设置 `$env:RUN_ID="<runId>"`，或查看 `sim/data/runs/LATEST_DEMO_RUN.txt`。

**Q: 改前端样式不生效？**  
开发用 `frontend:dev`；预览构建结果用 `frontend:build` + `frontend:serve`。

**Q: typecheck 过了但前端报错？**  
另跑 `npx tsc -p sim/frontend/game/tsconfig.json --noEmit`。

**Q: 推送 git 很大/很慢？**  
检查是否误加 `node_modules`、`sim/data/runs/*/`、`replay_data.json`。

---

## 延伸阅读

| 文档 | 内容 |
| --- | --- |
| [`reference/project-plan-board.md`](./reference/project-plan-board.md) | 完整 Phase 0–6 计划与模块索引 |
| [`reference/task-board.md`](./reference/task-board.md) | 7 日极简冲刺板 |
| [`sim/data/runs/README.md`](./sim/data/runs/README.md) | run 目录结构说明 |
