// Touchpoint ideas: reasons to reach out that give something, rather than
// "just checking in". One shows under each due person, rotating daily.
import { hash, todayStr, daysBetween, parseDate } from './util.js';
import { yearlyWindow } from './cadence.js';
import { relTypesOf } from './model.js';

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

// For past clients: they've hired you once, so the reason to reach out is
// the work you made for them and what you could make next.
const PAST_CLIENT = [
  "Send a frame from their shoot they haven't seen yet.",
  'Ask how the images worked for them.',
  "Share what you've shot since you worked together.",
  'Send a print from the work you made for them.',
  'Let them know your availability for their next season.',
  'Send a thank-you on the anniversary of your shoot together.',
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

// By how engaged someone seems. Eager gets concrete asks, open gets light
// invitations, lukewarm gets give-first gestures only: never a pitch.
const BY_INTEREST = {
  eager: [
    'Pitch a specific shoot date.',
    'Send a mood board for the next idea.',
    'Suggest two dates for a test or a coffee.',
    'Send a one-page treatment for a shoot you could make together.',
    'Ask what their next project needs, and offer a date.',
  ],
  open: [
    "Share a new frame and mention you'd love to shoot again.",
    'Send recent work with a light "if the timing ever works".',
    'Share a project you just finished, and say it made you think of them.',
    'Invite them to see new work, no pressure attached.',
    "Mention you'll be near them soon, and would love a coffee if they're free.",
  ],
  lukewarm: [
    'Send a print.',
    'React to their recent work.',
    'Share something relevant to their world.',
    'Congratulate them on something they made.',
    "Pass along an article or reference they'd enjoy.",
    'Send a thank-you, with nothing asked in return.',
  ],
};

// Light touch: weak ties get small, give-first gestures only, whatever the
// relationship. Never prints, letters, gifts, calls, meetings or pitches.
const LIGHT = [
  'React to a recent post.',
  'Leave a thoughtful comment on their work.',
  'Send them a frame they might like.',
  'Share their work in your stories.',
  'Congratulate them on something they posted.',
];
// Lukewarm light touches keep to the gentlest of those.
const LIGHT_LUKEWARM = [LIGHT[0], LIGHT[1], LIGHT[4]];
const LIGHT_FALLBACK = 'React to something they shared lately.';

export const IDEAS = GENERAL;

// Before the first touchpoint, ideas fit how you came across them.
const FIRST_CONTACT = {
  justMet: ["Send a quick note while it's fresh.", 'Share the frame or idea you talked about.'],
  reachOutNow: [
    'Introduce yourself and share one piece of work that fits what they do.',
    'Reference something specific about their work or roster.',
  ],
};
FIRST_CONTACT.pickDate = FIRST_CONTACT.reachOutNow;
// A light touch with no touchpoints yet (see ideaStage in cadence.js).
FIRST_CONTACT.lightTouch = ['Follow them and react to a recent post.'];

// Your own suggestions and the ones you removed for good. The app sets this
// after every load, so each pick, on screen and in the calendar file, uses it.
let library = { own: [], ownKeys: new Set(), hidden: new Set() };

export function setIdeaLibrary(records) {
  const own = records.filter((r) => r.source === 'own' && !r.hidden).map((r) => r.text);
  library = {
    own,
    ownKeys: new Set(own.map((t) => t.toLowerCase())),
    hidden: new Set(records.filter((r) => r.source === 'builtin' && r.hidden).map((r) => r.text.toLowerCase())),
  };
}

export const isOwnIdea = (text) => library.ownKeys.has(String(text).toLowerCase());

// Shown only if every suggestion that fits someone has been removed.
export const FALLBACK_IDEA = 'Reach out with something that gives: a frame, a print or a thank-you.';

export function ideasFor(person, { firstContact = null } = {}) {
  const first = (FIRST_CONTACT[firstContact] || []).filter((t) => !library.hidden.has(t.toLowerCase()));
  if (first.length) return first;
  // Light touches only ever get light ideas: your own suggestions stay out,
  // since they may be bigger asks.
  if (person && person.lightTouch) {
    const light = (person.interest === 'lukewarm' ? LIGHT_LUKEWARM : LIGHT).filter((t) => !library.hidden.has(t.toLowerCase()));
    return light.length ? light : [LIGHT_FALLBACK];
  }
  const base = builtInIdeasFor(person).filter((t) => !library.hidden.has(t.toLowerCase()));
  // Your own ideas join every pool except lukewarm, which stays give-first.
  const own = person && person.interest === 'lukewarm' ? [] : library.own;
  const list = [...base, ...own];
  return list.length ? list : [FALLBACK_IDEA];
}

function builtInIdeasFor(person) {
  // A known interest level leads; unknown falls back to relationship and
  // role. Someone with several relationship types gets each one's ideas.
  if (person && BY_INTEREST[person.interest]) return BY_INTEREST[person.interest];
  const types = relTypesOf(person);
  const role = (person && person.role) || '';
  const list = [];
  if (types.includes('pastClient')) list.push(...PAST_CLIENT);
  if (types.includes('collaborator')) list.push(...COLLABORATOR);
  if (types.includes('prospect') || types.includes('industry')) {
    list.push(...BY_ROLE.filter((r) => r.match.test(role)).flatMap((r) => r.ideas), ...GENERAL);
  }
  return [...new Set(list)];
}

// Same idea all day for the same person; `turn` steps to the next one.
// `firstContact` is the person's first contact stage, if any.
export function pickIdea(person, dateStr, turn = 0, { firstContact = null } = {}) {
  const list = ideasFor(person, { firstContact });
  return list[(hash(`${person.id}|${dateStr}`) + turn) % list.length];
}

// When a yearly date (a birthday, say) is within the week, the idea is about
// that: "Birthday on Friday. A card or print would land well." A light touch
// gets a quick message instead of a card or print.
export function yearlyIdea(newsList, tps, today = todayStr(), { light = false } = {}) {
  let best = null;
  for (const n of newsList) {
    if (!n.repeatsYearly) continue;
    const w = yearlyWindow(n, tps, today);
    if (!w) continue;
    const day = w === 'today' ? today : w;
    if (!best || day < best.day) best = { n, day };
  }
  if (!best) return null;
  const ahead = daysBetween(today, best.day);
  const when = ahead === 0 ? 'today' : ahead === 1 ? 'tomorrow' : `on ${parseDate(best.day).toLocaleDateString(undefined, { weekday: 'long' })}`;
  const gift = light ? 'A quick message would be enough.' : /birthday/i.test(best.n.description) ? 'A card or print would land well.' : 'A note or a print would land well.';
  return `${best.n.description} ${when}. ${gift}`;
}
