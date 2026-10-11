export const QUEST_TAGS = [
  { code: 'plastic', label: 'Plastic', icon: '♻️' },
  { code: 'paper', label: 'Paper', icon: '📰' },
  { code: 'glass', label: 'Glass', icon: '🫙' },
  { code: 'metal', label: 'Cans', icon: '🥫' },
  { code: 'organic', label: 'Organic', icon: '🍂' },
  { code: 'textiles', label: 'Textiles', icon: '🧶' },
  { code: 'electronics', label: 'E-waste', icon: '🔋' },
  { code: 'mixed', label: 'Mixed', icon: '🧹' },
] as const;

export const SAFETY_FLAGS = [
  {
    code: 'sharps',
    label: 'Sharps',
    icon: '⚠️',
    warning:
      'Needles or syringes may be present. Volunteers will be told not to pick them up and will be shown drop-off and sanitation escalation information.',
  },
  {
    code: 'biohazard',
    label: 'Biohazard',
    icon: '☣️',
    warning:
      'Biological waste may be present. Volunteers will be told not to touch it and will be shown drop-off and sanitation escalation information.',
  },
] as const;

export type SafetyFlag = (typeof SAFETY_FLAGS)[number];
export type SafetyFlagCode = SafetyFlag['code'];
