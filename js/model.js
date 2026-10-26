// Fixed lists the data model uses: stored keys plus the words shown for them.

export const TOUCH_TYPES = [
  { key: 'email', label: 'Email' },
  { key: 'dm', label: 'DM' },
  { key: 'call', label: 'Call' },
  { key: 'meeting', label: 'Meeting' },
  { key: 'sent_work', label: 'Sent work' },
  { key: 'comment', label: 'Comment on their work' },
  { key: 'gift', label: 'Gift or card' },
  { key: 'event', label: 'Event' },
  { key: 'other', label: 'Other' },
];

export function touchTypeLabel(key) {
  const t = TOUCH_TYPES.find((x) => x.key === key);
  return t ? t.label : key || 'Other';
}

export const RESPONDED = [
  { key: 'pending', label: 'Waiting' },
  { key: 'yes', label: 'Replied' },
  { key: 'no', label: 'No reply' },
];

export function respondedLabel(key) {
  const r = RESPONDED.find((x) => x.key === key);
  return r ? r.label : 'Waiting';
}

export const ROLE_SUGGESTIONS = [
  'Casting director',
  'Talent manager',
  'Agency booker',
  'Brand marketer',
  'Editor',
  'Producer',
  'Actor',
  'Client',
];

export const ORG_TYPES = [
  { key: 'agency', label: 'Agency' },
  { key: 'brand', label: 'Brand' },
  { key: 'production', label: 'Production company' },
  { key: 'publication', label: 'Publication' },
  { key: 'studio', label: 'Studio' },
  { key: 'other', label: 'Other' },
];

export function orgTypeLabel(key) {
  const t = ORG_TYPES.find((x) => x.key === key);
  return t ? t.label : 'Other';
}

export const NEWS_SUGGESTIONS = [
  'Show premieres',
  'Campaign launches',
  'New agency',
  'New job',
  'Book comes out',
  'Season wraps',
  'Birthday',
];

// What a relationship is for, separate from how warm it is. Cadence never
// looks at this; it shapes the touchpoint ideas and helps filter.
export const RELATIONSHIP_TYPES = [
  { key: 'prospect', label: 'Prospect', blurb: 'Someone who could hire you.' },
  { key: 'pastClient', label: 'Past client', blurb: "Someone who's hired you. Stay in touch for the next job." },
  { key: 'collaborator', label: 'Collaborator', blurb: 'Someone you make work with: models, actors, artists.' },
  { key: 'industry', label: 'Industry', blurb: 'Someone who connects you to work: agents, bookers, editors, casting.' },
];

export const DEFAULT_RELATIONSHIP = 'prospect';

export function relationshipInfo(key) {
  return RELATIONSHIP_TYPES.find((r) => r.key === key) || RELATIONSHIP_TYPES[0];
}

// Open loops: small promises, either way.
export const LOOP_DIRECTIONS = [
  { key: 'iOwe', label: 'You owe', blurb: 'Something you promised.' },
  { key: 'theyOwe', label: 'They owe', blurb: "Something they promised, or you're waiting on." },
];

// How engaged someone seems. It shapes the touchpoint ideas; cadence never
// looks at it.
export const INTEREST_LEVELS = [
  { key: 'eager', label: 'Eager', blurb: 'Excited to work together.' },
  { key: 'open', label: 'Open', blurb: 'Interested if the timing works.' },
  { key: 'lukewarm', label: 'Lukewarm', blurb: 'Friendly but not leaning in.' },
  { key: 'unknown', label: 'Unknown', blurb: 'Not sure yet.' },
];

export const DEFAULT_INTEREST = 'unknown';

export function interestInfo(key) {
  return INTEREST_LEVELS.find((i) => i.key === key) || INTEREST_LEVELS[3];
}
