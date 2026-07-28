# Experiment runs

Each run directory typically contains:

```
<runId>/
  config.json
  event_log.jsonl
  replay_index.json
  snapshots/
    D1-AM.json
    ...
```

## Named archives

See `NAMED_RUNS.json`. Example: **`test1`** is a directory junction to
`live100_365d_20260725_1643` (100 agents × 365 days live baseline).

```bash
RUN_ID=test1 npm run frontend:export
RUN_ID=test1 npm run analyze:stratification
```

## Launch params

Prefer JSON presets under `sim/data/experiment_params/` (see that folder’s README).
Keep one **gold** run for demo; delete noisy intermediates.
