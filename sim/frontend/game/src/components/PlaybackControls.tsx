interface PlaybackControlsProps {
  /** Position within the current navigable step list (0-based). */
  position: number;
  total: number;
  canPrevious: boolean;
  canNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onJump: (position: number) => void;
  onReplayAct: () => void;
  focusLabel?: string;
}

export function PlaybackControls({
  position,
  total,
  canPrevious,
  canNext,
  onPrevious,
  onNext,
  onJump,
  onReplayAct,
  focusLabel,
}: PlaybackControlsProps) {
  const progress = total > 1 ? (position / (total - 1)) * 100 : 100;
  return (
    <nav className="playback-controls pixel-panel" aria-label="回放控制">
      <button
        type="button"
        className="pixel-button"
        onClick={onPrevious}
        disabled={!canPrevious}
      >
        <span aria-hidden="true">◀</span> 上一步
      </button>
      <button
        type="button"
        className="pixel-button secondary"
        onClick={onReplayAct}
      >
        重播本幕
      </button>
      <label className="progress-control">
        <span className="sr-only">回放进度</span>
        <input
          type="range"
          min={0}
          max={Math.max(total - 1, 0)}
          value={Math.min(position, Math.max(total - 1, 0))}
          onChange={(event) => onJump(Number(event.target.value))}
          style={{ "--progress": `${progress}%` } as React.CSSProperties}
        />
        <small>
          STEP {String(position + 1).padStart(3, "0")} /{" "}
          {String(total).padStart(3, "0")}
          {focusLabel ? ` · ${focusLabel}` : ""}
        </small>
      </label>
      <button
        type="button"
        className="pixel-button primary"
        onClick={onNext}
        disabled={!canNext}
      >
        下一步 <span aria-hidden="true">▶</span>
      </button>
    </nav>
  );
}
