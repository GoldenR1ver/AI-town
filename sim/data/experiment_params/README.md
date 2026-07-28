# 实验参数（Experiment Params）

主入口改为 JSON 参数文件，而不是一长串环境变量。

## 目录

`sim/data/experiment_params/*.json`

| Preset | 用途 |
|--------|------|
| `baseline_16_30d` | 默认：16 人 × 30 天 mock |
| `test1` | 归档复现参数（100×365 live）；默认新 runId=`test1_rerun` |
| `live100_365d_baseline` | 同参、自动生成 runId |
| `ablation_cell` | 消融矩阵单格模板 |
| `contrast_cell` | 对照矩阵单格模板 |

## 用法

```bash
# 推荐
npm run sim:run -- --preset baseline_16_30d
npm run sim:run -- --preset test1
npm run sim:run:live100

# 或显式路径
npm run sim:run -- --params sim/data/experiment_params/live100_365d_baseline.json
```

可选：仅在需要时用环境变量覆盖（`RUN_ID` / `SEED` / `END_DAY` / `P5_LLM_MODE` 等）。  
LLM 密钥仍用 `AGENTSOCIETY_LLM_*`。

## 归档名 test1

`sim/data/runs/test1` → `live100_365d_20260725_1643`  
见 `NAMED_RUNS.json` 与 `LATEST_TEST1.txt`。
