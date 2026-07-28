import type { ReplayStep } from "@shared/replay/types";
import { useCallback, useEffect, useMemo } from "react";

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
  const position = useMemo(() => {
    const exact = steps.findIndex((step) => step.index === index);
    if (exact >= 0) return exact;
    const next = steps.findIndex((step) => step.index > index);
    if (next >= 0) return next;
    return Math.max(steps.length - 1, 0);
  }, [index, steps]);

  const lastPosition = Math.max(steps.length - 1, 0);

  const next = useCallback(() => {
    if (!steps.length) return;
    const pos = steps.findIndex((step) => step.index === index);
    if (pos >= 0) {
      if (pos < steps.length - 1) setIndex(steps[pos + 1]!.index);
      return;
    }
    const upcoming = steps.find((step) => step.index > index);
    if (upcoming) setIndex(upcoming.index);
    else setIndex(steps[steps.length - 1]!.index);
  }, [index, setIndex, steps]);

  const previous = useCallback(() => {
    if (!steps.length) return;
    const pos = steps.findIndex((step) => step.index === index);
    if (pos > 0) {
      setIndex(steps[pos - 1]!.index);
      return;
    }
    if (pos === 0) return;
    const prior = [...steps].reverse().find((step) => step.index < index);
    if (prior) setIndex(prior.index);
    else setIndex(steps[0]!.index);
  }, [index, setIndex, steps]);

  /** Jump by position within the current (possibly filtered) step list. */
  const jumpTo = useCallback(
    (targetPosition: number) => {
      if (!steps.length) return;
      const clamped = Math.max(0, Math.min(targetPosition, steps.length - 1));
      setIndex(steps[clamped]!.index);
    },
    [setIndex, steps],
  );

  /** Jump directly to a step.index value. */
  const jumpToStepIndex = useCallback(
    (stepIndex: number) => {
      setIndex(stepIndex);
    },
    [setIndex],
  );

  const replayAct = useCallback(() => {
    const current =
      steps.find((step) => step.index === index) ??
      steps.find((step) => step.index >= index) ??
      steps[0];
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
        jumpTo(lastPosition);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [jumpTo, lastPosition, next, previous]);

  return {
    next,
    previous,
    jumpTo,
    jumpToStepIndex,
    replayAct,
    position,
    total: steps.length,
    canNext: position < lastPosition && steps.length > 0,
    canPrevious: position > 0 && steps.length > 0,
  };
}
