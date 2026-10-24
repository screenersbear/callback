// Touchpoint ideas: reasons to reach out that give something, rather than
// "just checking in". One shows under each due person, rotating daily.
import { hash } from './util.js';

const GENERAL = [
  "Send a recent frame that fits something they're working on.",
  'Congratulate them on a recent project or launch.',
  'Share a reference or article relevant to their work.',
  'Send selects or a thank-you after working together.',
  'Invite them to see new work.',
  'Tell them about a project of theirs you admired, and why.',
  'Share a personal project you just finished.',
  'Introduce them to someone who could help them.',
  'Send a behind-the-scenes shot from a recent set.',
  'Leave a thoughtful comment on something they posted.',
  'Tell them about a location or idea that made you think of them.',
  "Mention an event or screening you'll both be at.",
  'Send a printed photo or a handwritten card.',
  'Share one new frame and one line about what you are working on.',
];

// Matched against the person's role, case-insensitively.
const BY_ROLE = [
  {
    match: /casting/i,
    ideas: [
      'Send a portrait that shows the kind of faces they cast.',
      'Share new headshots of actors who might suit their current projects.',
    ],
  },
  {
    match: /manager|booker|agen/i,
    ideas: [
      'Offer a test shoot for one of their newer faces.',
      'Send recent work you made with someone on their roster.',
    ],
  },
  {
    match: /brand|market/i,
    ideas: [
      "Share a frame that fits their brand's current campaign.",
      'Send a short idea for their next season or launch.',
    ],
  },
  {
    match: /editor/i,
    ideas: ['Pitch a story idea that fits their section.', 'Send a recent series that suits their pages.'],
  },
  {
    match: /producer/i,
    ideas: [
      'Let them know your availability for the coming months.',
      'Send a quick recap of a recent shoot that went smoothly.',
    ],
  },
  {
    match: /actor|actress|talent/i,
    ideas: [
      'Send a favorite frame from your last session together.',
      'Congratulate them on a recent role or booking.',
    ],
  },
  {
    match: /client/i,
    ideas: [
      "Send a frame from their shoot they haven't seen yet.",
      'Ask how the images are working for them, and share a new idea.',
    ],
  },
];

// For collaborators: people you make work with, so the reason to reach out
// is the work itself, not a pitch.
const COLLABORATOR = [
  'Share a new frame from your shoot together.',
  'Send a print of a favorite frame from your work together.',
  'Pitch a new shoot idea you could make together.',
  "Send a mood board for something you'd love to make with them.",
  'Send them selects they can use in their own portfolio.',
  'Share a behind-the-scenes shot from your last shoot together.',
  'Tag them in a post of the work you made together.',
  "Ask what they're excited about lately, and whether they'd like to test something new.",
];

export const IDEAS = GENERAL;

export function ideasFor(person) {
  if (person && person.relationshipType === 'collaborator') return COLLABORATOR;
  const role = (person && person.role) || '';
  const own = BY_ROLE.filter((r) => r.match.test(role)).flatMap((r) => r.ideas);
  return [...own, ...GENERAL];
}

// Same idea all day for the same person; `turn` steps to the next one.
export function pickIdea(person, dateStr, turn = 0) {
  const list = ideasFor(person);
  return list[(hash(`${person.id}|${dateStr}`) + turn) % list.length];
}
