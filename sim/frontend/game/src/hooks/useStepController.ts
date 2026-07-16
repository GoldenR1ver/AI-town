import type { ReplayStep } from "@shared/replay/types";
import { useCallback, useEffect } from "react";

interface StepControllerOptions {
  steps: ReplayStep[];
  index: number;
  setIndex: (index: number) => void;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A"].includes(target.tagName);
}

export function useStepController({
  steps,
  index,
  setIndex,
}: StepControllerOptions) {
  const lastIndex = Math.max(steps.length - 1, 0);
  const next = useCallback(
    () => setIndex(Math.min(index + 1, lastIndex)),
    [index, lastIndex, setIndex],
  );
  const previous = useCallback(
    () => setIndex(Math.max(index - 1, 0)),
    [index, setIndex],
  );
  const jumpTo = useCallback(
    (target: number) => setIndex(Math.max(0, Math.min(target, lastIndex))),
    [lastIndex, setIndex],
  );
  const replayAct = useCallback(() => {
    const current = steps[index];
    if (!current) return;
    const first = steps.find(
      (step) =>
        step.act === current.act &&
        step.simTime.day === current.simTime.day &&
        step.simTime.slot === current.simTime.slot,
    );
    if (first) setIndex(first.index);
  }, [index, setIndex, steps]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || isEditableTarget(event.target)) return;
      if (event.code === "Space" || event.code === "ArrowRight") {
        event.preventDefault();
        next();
      } else if (event.code === "ArrowLeft") {
        event.preventDefault();
        previous();
      } else if (event.code === "Home") {
        event.preventDefault();
        jumpTo(0);
      } else if (event.code === "End") {
        event.preventDefault();
        jumpTo(lastIndex);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [jumpTo, lastIndex, next, previous]);

  return {
    next,
    previous,
    jumpTo,
    replayAct,
    canNext: index < lastIndex,
    canPrevious: index > 0,
  };
}
