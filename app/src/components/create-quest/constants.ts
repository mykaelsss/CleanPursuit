// Icons for the category and hazard codes from GET /tags. Labels and warnings come from the API.
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

// Hazards without an icon here use ⚠️.
export const HAZARD_ICONS: Record<string, string> = {
  sharps: '💉',
  biohazard: '☣️',
  chemicals: '🧪',
  bulky_items: '🛋️',
};
