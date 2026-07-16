# 礼物的流动 — Gift Flow Sim

基于阎云翔《礼物的流动》启发的 **multi-agent 社会学仿真 MVP**。  
核心链路：`事务触发 →（薄）对话叙事 → RuleEngine 改关系/经济/礼物 → JSONL 回放`。

## 目录

```
myProject/
├── reference/task-board.md   # 7 日双人任务板
├── sim/
│   ├── backend/              # 仿真引擎与六大系统（薄实现）
│   ├── frontend/game/        # React + Vite + PixiJS 像素回放
│   ├── shared/replay/        # 回放数据契约与日志 reducer
│   ├── shared/types/         # 冻结 Schema
│   └── data/                 # agents / 模板 / runs
├── package.json
└── README.md
```

## 快速开始

```bash
cd myProject
npm install
npm run sim:empty    # 空跑时钟 + 写 JSONL/snapshot（默认 30 slots）
npm run verify:d1    # D1 一键验收
npm run typecheck
```

空跑产物默认写到 `sim/data/runs/<runId>/`。

## AI-town 像素步进回放

使用最新 `LATEST_DEMO_RUN.txt` 指向的已有 run，一键导出、构建并启动：

```bash
npm run frontend:start
# 打开 http://127.0.0.1:5177/
```

从头生成 mock demo 后再打开：

```bash
npm run demo             # 仿真 + 语义回放数据 + 前端构建
npm run frontend:serve   # http://127.0.0.1:5177/
```

开发模式：

```bash
npm run frontend:export  # 输出 game/public/replay_data.json
npm run frontend:dev     # Vite 热更新，http://127.0.0.1:5177/
```

需要回放指定 run 时，在 PowerShell 中先设置 `$env:RUN_ID="<runId>"` 再执行
`npm run frontend:export`。静态验证使用 `npm run verify:frontend`；它会检查步骤顺序、
每条对话消息只出现一次、事件可追踪，并逐 slot 从日志重建关系、BDIE、经济和礼单，
与原 snapshot checkpoint 对照。

操作：

- `Space` / `→`：下一个可见步骤；每条 `dialogue.message` 单独成步。
- `←`：上一步；`Home` / `End`：跳到开头 / 结尾。
- 时间轴和底部滑杆可直接跳转；“重播本幕”回到当前 act 开始。
- 点击地图角色或关系图节点会联动 BDIE Inspector；“已固定”可取消并重新跟随当前 speaker/affected agent。

该 UI 是纯离线回放：`event_log.jsonl` 与 slot snapshot 是唯一状态源，不连接 Convex，
也不会推进后端仿真。AI-town 的地图、角色 spritesheet 和像素 UI 仅用于渲染，
许可副本随构建输出为 `AI_TOWN_LICENSE.txt`。

## LLM 环境变量（与 AgentSociety 对齐）

| 变量 | 说明 |
| --- | --- |
| `AGENTSOCIETY_LLM_API_BASE` | API Base（默认 `https://api.openai.com/v1`，不要带 `/chat/completions`） |
| `AGENTSOCIETY_LLM_API_KEY` | API Key（live 必填） |
| `AGENTSOCIETY_LLM_MODEL` | 模型名（live 必填） |

可选：`LLM_MODE=mock|live|auto`（默认 `auto`：有 KEY+MODEL 则走 live，否则 mock）。

PowerShell 示例：

```powershell
$env:AGENTSOCIETY_LLM_API_BASE="https://llmapi.example.com/v1"
$env:AGENTSOCIETY_LLM_API_KEY="sk-..."
$env:AGENTSOCIETY_LLM_MODEL="gpt-4o-mini"
npm run llm:ping
```

也可复制 `.env.example` 为本地配置备忘（勿提交密钥）。实现见 `sim/backend/llm/client.ts`。

## Phase 验收

```bash
npm run verify:p0     # Phase 0：契约/空跑/Replay/模板库
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

```powershell
$env:P2_LLM_MODE="live"
$env:P2_ALL_MODES="0"       # 只跑一场 6 轮对话，减少 API 调用
npm run sim:p2
```

P2 产物：`event_log.jsonl`、`conversation_table.jsonl` 和包含 `conversations` 的 slot snapshot。

## 设计原则（勿破）

1. LLM 只产出文本与意图提案，不直接写世界状态。
2. 所有状态变更经 `RuleEngine`，并写入 append-only 日志。
3. 前端只读日志与快照，不读 agent 私有工作区当真理源。

## 任务与规格

- **完整开发计划板**：[`reference/project-plan-board.md`](./reference/project-plan-board.md)（Phase 0–6）
- 7 日极简冲刺板：[`reference/task-board.md`](./reference/task-board.md)
- 总计划：仓库根目录 `../reference/plan.md`
