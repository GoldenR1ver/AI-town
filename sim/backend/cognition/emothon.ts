/** Legacy emotion-only style helper. Full Phase 2 style lives in dialogue/style.ts. */
export interface LegacyEmotionStyle {
  verbosity: number;
  formality: number;
  riskTaking: number;
  warmth: number;
}

export function emotionToStyle(emotion: {
  mood: number;
  arousal: number;
  stress: number;
  energy: number;
}): LegacyEmotionStyle {
  return {
    verbosity: 0.4 + emotion.energy * 0.4,
    formality: 0.5 + emotion.stress * 0.2,
    riskTaking: 0.3 + emotion.mood * 0.4 - emotion.stress * 0.2,
    warmth: emotion.mood,
  };
}
