import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { IDEAS, FALLBACK_IDEA, setIdeaLibrary, isOwnIdea, ideasFor, pickIdea, yearlyIdea } from '../../js/ideas.js';
import { hash } from '../../js/util.js';

// The built-in pools, written out so a changed or emptied idea is caught.
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
const ROLE = {
  casting: [
    'Send a portrait that shows the kind of faces they cast.',
    'Share new headshots of actors who might suit their current projects.',
  ],
  agent: ['Offer a test shoot for one of their newer faces.', 'Send recent work you made with someone on their roster.'],
  brand: ["Share a frame that fits their brand's current campaign.", 'Send a short idea for their next season or launch.'],
  editor: ['Pitch a story idea that fits their section.', 'Send a recent series that suits their pages.'],
  producer: [
    'Let them know your availability for the coming months.',
    'Send a quick recap of a recent shoot that went smoothly.',
  ],
  talent: ['Send a favorite frame from your last session together.', 'Congratulate them on a recent role or booking.'],
  client: [
    "Send a frame from their shoot they haven't seen yet.",
    'Ask how the images are working for them, and share a new idea.',
  ],
};
const PAST_CLIENT = [
  "Send a frame from their shoot they haven't seen yet.",
  'Ask how the images worked for them.',
  "Share what you've shot since you worked together.",
  'Send a print from the work you made for them.',
  'Let them know your availability for their next season.',
  'Send a thank-you on the anniversary of your shoot together.',
];
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
const EAGER = [
  'Pitch a specific shoot date.',
  'Send a mood board for the next idea.',
  'Suggest two dates for a test or a coffee.',
  'Send a one-page treatment for a shoot you could make together.',
  'Ask what their next project needs, and offer a date.',
];
const OPEN = [
  "Share a new frame and mention you'd love to shoot again.",
  'Send recent work with a light "if the timing ever works".',
  'Share a project you just finished, and say it made you think of them.',
  'Invite them to see new work, no pressure attached.',
  "Mention you'll be near them soon, and would love a coffee if they're free.",
];
const LUKEWARM = [
  'Send a print.',
  'React to their recent work.',
  'Share something relevant to their world.',
  'Congratulate them on something they made.',
  "Pass along an article or reference they'd enjoy.",
  'Send a thank-you, with nothing asked in return.',
];
const LIGHT = [
  'React to a recent post.',
  'Leave a thoughtful comment on their work.',
  'Send them a frame they might like.',
  'Share their work in your stories.',
  'Congratulate them on something they posted.',
];
const LIGHT_LUKEWARM = [LIGHT[0], LIGHT[1], LIGHT[4]];
const LIGHT_FALLBACK = 'React to something they shared lately.';
const JUST_MET = ["Send a quick note while it's fresh.", 'Share the frame or idea you talked about.'];
const REACH_OUT = [
  'Introduce yourself and share one piece of work that fits what they do.',
  'Reference something specific about their work or roster.',
];
const LIGHT_FIRST = ["Follow them and send a quick note while it's fresh."];

const hideAll = (texts) => texts.map((text) => ({ source: 'builtin', text, hidden: true }));

beforeEach(() => setIdeaLibrary([]));
afterEach(() => vi.useRealTimers());

describe('before the app sets the library', () => {
  it('starts with no own ideas and nothing removed', async () => {
    vi.resetModules();
    const fresh = await import('../../js/ideas.js');
    expect(fresh.ideasFor({})).toEqual(GENERAL);
    expect(fresh.ideasFor({ interest: 'eager' })).toEqual(EAGER);
    expect(fresh.isOwnIdea('Pitch a specific shoot date.')).toBe(false);
  });
});

describe('constants', () => {
  it('exports the general ideas and the fallback', () => {
    expect(IDEAS).toEqual(GENERAL);
    expect(FALLBACK_IDEA).toBe('Reach out with something that gives: a frame, a print or a thank-you.');
  });
});

describe('setIdeaLibrary and isOwnIdea', () => {
  it('knows your own ideas, case-insensitively', () => {
    setIdeaLibrary([{ source: 'own', text: 'Send the Test Zine.' }]);
    expect(isOwnIdea('Send the Test Zine.')).toBe(true);
    expect(isOwnIdea('SEND THE TEST ZINE.')).toBe(true);
    expect(isOwnIdea('send the test zine.')).toBe(true);
  });

  it('does not count built-in, hidden or unknown ideas as your own', () => {
    setIdeaLibrary([
      { source: 'own', text: 'Gone idea', hidden: true },
      { source: 'builtin', text: 'Send a print.', hidden: false },
      { source: 'builtin', text: 'Pitch a specific shoot date.', hidden: true },
    ]);
    expect(isOwnIdea('Gone idea')).toBe(false);
    expect(isOwnIdea('Send a print.')).toBe(false);
    expect(isOwnIdea('Pitch a specific shoot date.')).toBe(false);
    expect(isOwnIdea('Something else')).toBe(false);
  });

  it('copes with non-string input', () => {
    setIdeaLibrary([{ source: 'own', text: '42' }]);
    expect(isOwnIdea(42)).toBe(true);
    expect(isOwnIdea(null)).toBe(false);
    expect(isOwnIdea(undefined)).toBe(false);
  });

  it('starts empty and resets with an empty list', () => {
    setIdeaLibrary([{ source: 'own', text: 'Mine' }]);
    expect(isOwnIdea('Mine')).toBe(true);
    setIdeaLibrary([]);
    expect(isOwnIdea('Mine')).toBe(false);
    expect(ideasFor({})).toEqual(GENERAL);
  });

  it('only hides built-in ideas marked hidden, matching any case', () => {
    setIdeaLibrary([
      { source: 'builtin', text: 'SEND A PRINT.', hidden: true },
      { source: 'builtin', text: 'React to their recent work.', hidden: false },
      { source: 'own', text: 'Share something relevant to their world.', hidden: true },
    ]);
    expect(ideasFor({ interest: 'lukewarm' })).toEqual(LUKEWARM.slice(1));
  });
});

describe('ideasFor: by relationship and role', () => {
  it('gives the general ideas to a plain prospect, and with no person at all', () => {
    expect(ideasFor({})).toEqual(GENERAL);
    expect(ideasFor(undefined)).toEqual(GENERAL);
    expect(ideasFor(null)).toEqual(GENERAL);
    expect(ideasFor({ role: 'Unknown job' })).toEqual(GENERAL);
  });

  it('leads with role ideas for each kind of role', () => {
    expect(ideasFor({ role: 'Casting Director' })).toEqual([...ROLE.casting, ...GENERAL]);
    expect(ideasFor({ role: 'Booker' })).toEqual([...ROLE.agent, ...GENERAL]);
    expect(ideasFor({ role: 'talent manager' })).toEqual([...ROLE.agent, ...ROLE.talent, ...GENERAL]);
    expect(ideasFor({ role: 'Marketing lead' })).toEqual([...ROLE.brand, ...GENERAL]);
    expect(ideasFor({ role: 'Photo EDITOR' })).toEqual([...ROLE.editor, ...GENERAL]);
    expect(ideasFor({ role: 'Executive Producer' })).toEqual([...ROLE.producer, ...GENERAL]);
    expect(ideasFor({ role: 'Actress' })).toEqual([...ROLE.talent, ...GENERAL]);
    expect(ideasFor({ role: 'Client services' })).toEqual([...ROLE.client, ...GENERAL]);
  });

  it('gives industry and other contacts the role and general ideas too', () => {
    expect(ideasFor({ relationshipTypes: ['industry'], role: 'Agent' })).toEqual([...ROLE.agent, ...GENERAL]);
    expect(ideasFor({ relationshipTypes: ['other'], role: 'Brand lead' })).toEqual([...ROLE.brand, ...GENERAL]);
  });

  it('gives past clients and collaborators their own pools only', () => {
    expect(ideasFor({ relationshipTypes: ['pastClient'], role: 'Producer' })).toEqual(PAST_CLIENT);
    expect(ideasFor({ relationshipTypes: ['collaborator'], role: 'Actor' })).toEqual(COLLABORATOR);
    expect(ideasFor({ relationshipType: 'collaborator' })).toEqual(COLLABORATOR);
  });

  it('combines the pools of several relationship types, without repeats', () => {
    expect(ideasFor({ relationshipTypes: ['collaborator', 'pastClient'] })).toEqual([...PAST_CLIENT, ...COLLABORATOR]);
    // The client role's first idea is also the first past-client idea: it shows once.
    expect(ideasFor({ relationshipTypes: ['pastClient', 'prospect'], role: 'Client' })).toEqual([
      ...PAST_CLIENT,
      ROLE.client[1],
      ...GENERAL,
    ]);
  });

  it('treats unknown relationship types as a prospect', () => {
    expect(ideasFor({ relationshipTypes: ['nonsense'] })).toEqual(GENERAL);
  });
});

describe('ideasFor: by interest', () => {
  it('uses the interest pool when the interest is known, over the relationship', () => {
    expect(ideasFor({ interest: 'eager', relationshipTypes: ['pastClient'] })).toEqual(EAGER);
    expect(ideasFor({ interest: 'open', role: 'Casting' })).toEqual(OPEN);
    expect(ideasFor({ interest: 'lukewarm' })).toEqual(LUKEWARM);
  });

  it('falls back to the relationship when interest is unknown or bad', () => {
    expect(ideasFor({ interest: 'unknown', relationshipTypes: ['collaborator'] })).toEqual(COLLABORATOR);
    expect(ideasFor({ interest: 'bogus' })).toEqual(GENERAL);
    expect(ideasFor({ interest: '' })).toEqual(GENERAL);
  });
});

describe('ideasFor: your own and removed ideas', () => {
  it('adds your own ideas after the built-in ones, keeping their case', () => {
    setIdeaLibrary([
      { source: 'own', text: 'Send the Test Zine.' },
      { source: 'own', text: 'Hidden mine', hidden: true },
      { source: 'builtin', text: 'Not mine' },
    ]);
    expect(ideasFor({})).toEqual([...GENERAL, 'Send the Test Zine.']);
    expect(ideasFor({ interest: 'eager' })).toEqual([...EAGER, 'Send the Test Zine.']);
    expect(ideasFor({ interest: 'open' })).toEqual([...OPEN, 'Send the Test Zine.']);
  });

  it('keeps your own ideas out of the lukewarm pool', () => {
    setIdeaLibrary([{ source: 'own', text: 'Send the Test Zine.' }]);
    expect(ideasFor({ interest: 'lukewarm' })).toEqual(LUKEWARM);
  });

  it('falls back when every idea that fits has been removed', () => {
    setIdeaLibrary(hideAll(LUKEWARM));
    expect(ideasFor({ interest: 'lukewarm' })).toEqual([FALLBACK_IDEA]);
  });

  it('shows only your own ideas when every built-in one is removed', () => {
    setIdeaLibrary([...hideAll(EAGER), { source: 'own', text: 'Mine only' }]);
    expect(ideasFor({ interest: 'eager' })).toEqual(['Mine only']);
  });

  it('still falls back for lukewarm when only your own ideas are left', () => {
    setIdeaLibrary([...hideAll(LUKEWARM), { source: 'own', text: 'Mine only' }]);
    expect(ideasFor({ interest: 'lukewarm' })).toEqual([FALLBACK_IDEA]);
  });
});

describe('ideasFor: first contact', () => {
  it('uses the first-contact pool for each stage', () => {
    expect(ideasFor({}, { firstContact: 'justMet' })).toEqual(JUST_MET);
    expect(ideasFor({}, { firstContact: 'reachOutNow' })).toEqual(REACH_OUT);
    expect(ideasFor({}, { firstContact: 'pickDate' })).toEqual(REACH_OUT);
    expect(ideasFor({}, { firstContact: 'lightTouch' })).toEqual(LIGHT_FIRST);
  });

  it('wins over light touch and interest', () => {
    expect(ideasFor({ lightTouch: true, interest: 'eager' }, { firstContact: 'justMet' })).toEqual(JUST_MET);
  });

  it('drops removed first-contact ideas, and moves on once all are removed', () => {
    setIdeaLibrary(hideAll([JUST_MET[0].toUpperCase()]));
    expect(ideasFor({}, { firstContact: 'justMet' })).toEqual([JUST_MET[1]]);
    setIdeaLibrary(hideAll(JUST_MET));
    expect(ideasFor({ interest: 'open' }, { firstContact: 'justMet' })).toEqual(OPEN);
  });

  it('ignores an unknown stage or a missing options object', () => {
    expect(ideasFor({}, { firstContact: 'bogus' })).toEqual(GENERAL);
    expect(ideasFor({}, {})).toEqual(GENERAL);
    expect(ideasFor({})).toEqual(GENERAL);
  });
});

describe('ideasFor: light touch', () => {
  it('gives light touches the light ideas only, whatever the relationship or own ideas', () => {
    setIdeaLibrary([{ source: 'own', text: 'Big ask' }]);
    expect(ideasFor({ lightTouch: true, relationshipTypes: ['pastClient'], interest: 'eager' })).toEqual(LIGHT);
  });

  it('keeps lukewarm light touches to the gentlest ones', () => {
    expect(ideasFor({ lightTouch: true, interest: 'lukewarm' })).toEqual(LIGHT_LUKEWARM);
  });

  it('drops removed light ideas and falls back when they are all gone', () => {
    setIdeaLibrary(hideAll([LIGHT[0]]));
    expect(ideasFor({ lightTouch: true })).toEqual(LIGHT.slice(1));
    setIdeaLibrary(hideAll(LIGHT_LUKEWARM));
    expect(ideasFor({ lightTouch: true, interest: 'lukewarm' })).toEqual([LIGHT_FALLBACK]);
    expect(ideasFor({ lightTouch: true })).toEqual([LIGHT[2], LIGHT[3]]);
  });

  it('treats a falsy lightTouch as a normal person', () => {
    expect(ideasFor({ lightTouch: false })).toEqual(GENERAL);
    expect(ideasFor({ lightTouch: 0, interest: 'eager' })).toEqual(EAGER);
  });
});

describe('pickIdea', () => {
  const p = { id: 'p1', name: 'Test Person' };
  const at = (person, date, turn = 0, list = GENERAL) => list[(hash(`${person.id}|${date}`) + turn) % list.length];

  it('picks the same idea all day from a stable hash', () => {
    expect(pickIdea(p, '2026-11-12')).toBe(at(p, '2026-11-12'));
    expect(pickIdea(p, '2026-11-12')).toBe(pickIdea(p, '2026-11-12', 0));
    expect(pickIdea(p, '2026-12-31')).toBe(at(p, '2026-12-31'));
    expect(pickIdea(p, '2027-01-01')).toBe(at(p, '2027-01-01'));
  });

  it('steps to the next idea with each turn and wraps around', () => {
    const start = GENERAL.indexOf(pickIdea(p, '2026-11-12'));
    for (const turn of [1, 2, 5, 13]) {
      expect(pickIdea(p, '2026-11-12', turn)).toBe(GENERAL[(start + turn) % GENERAL.length]);
    }
    expect(pickIdea(p, '2026-11-12', GENERAL.length)).toBe(pickIdea(p, '2026-11-12'));
  });

  it('picks from the first-contact pool when given a stage', () => {
    expect(pickIdea(p, '2026-11-12', 0, { firstContact: 'lightTouch' })).toBe(LIGHT_FIRST[0]);
    expect(pickIdea(p, '2026-11-12', 0, { firstContact: 'justMet' })).toBe(at(p, '2026-11-12', 0, JUST_MET));
    expect(pickIdea(p, '2026-11-12', 1, { firstContact: 'justMet' })).toBe(at(p, '2026-11-12', 1, JUST_MET));
  });

  it('picks from a one-item list every time', () => {
    setIdeaLibrary(hideAll(LUKEWARM));
    for (const turn of [0, 1, 7]) expect(pickIdea({ ...p, interest: 'lukewarm' }, '2026-11-12', turn)).toBe(FALLBACK_IDEA);
  });

  it('still picks for a person with no id', () => {
    expect(pickIdea({}, '2026-11-12')).toBe(at({}, '2026-11-12'));
  });
});

describe('yearlyIdea', () => {
  const TODAY = '2026-11-12';
  const weekday = (y, m, d) => new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'long' });
  const bday = (date, over = {}) => ({ id: 'n1', date, description: 'Birthday', repeatsYearly: true, ...over });

  it('returns null when nothing yearly is coming up', () => {
    expect(yearlyIdea([], [], TODAY)).toBeNull();
    expect(yearlyIdea([bday('1990-11-20')], [], TODAY)).toBeNull();
    expect(yearlyIdea([bday('1990-11-12', { repeatsYearly: false })], [], TODAY)).toBeNull();
  });

  it('says today, tomorrow, or the weekday', () => {
    expect(yearlyIdea([bday('1990-11-12')], [], TODAY)).toBe('Birthday today. A card or print would land well.');
    expect(yearlyIdea([bday('1990-11-13')], [], TODAY)).toBe('Birthday tomorrow. A card or print would land well.');
    expect(yearlyIdea([bday('1990-11-14')], [], TODAY)).toBe(`Birthday on ${weekday(2026, 11, 14)}. A card or print would land well.`);
    expect(yearlyIdea([bday('1990-11-19')], [], TODAY)).toBe(`Birthday on ${weekday(2026, 11, 19)}. A card or print would land well.`);
  });

  it('works across the end of the year', () => {
    expect(yearlyIdea([bday('1990-01-02')], [], '2026-12-29')).toBe(
      `Birthday on ${weekday(2027, 1, 2)}. A card or print would land well.`
    );
    expect(yearlyIdea([bday('1990-01-01')], [], '2026-12-31')).toBe('Birthday tomorrow. A card or print would land well.');
  });

  it('suggests a note for other yearly dates, matching birthday in any case', () => {
    const anniv = bday('2015-11-13', { description: 'Studio anniversary' });
    expect(yearlyIdea([anniv], [], TODAY)).toBe('Studio anniversary tomorrow. A note or a print would land well.');
    const loud = bday('1990-11-13', { description: "Test Person's BIRTHDAY" });
    expect(yearlyIdea([loud], [], TODAY)).toBe("Test Person's BIRTHDAY tomorrow. A card or print would land well.");
  });

  it('suggests a quick message for a light touch', () => {
    expect(yearlyIdea([bday('1990-11-13')], [], TODAY, { light: true })).toBe('Birthday tomorrow. A quick message would be enough.');
    const anniv = bday('2015-11-12', { description: 'Studio anniversary' });
    expect(yearlyIdea([anniv], [], TODAY, { light: true })).toBe('Studio anniversary today. A quick message would be enough.');
    expect(yearlyIdea([anniv], [], TODAY, { light: false })).toBe('Studio anniversary today. A note or a print would land well.');
  });

  it('picks the soonest date, and the first one listed on a tie', () => {
    const later = bday('1990-11-16', { id: 'a', description: 'Later birthday' });
    const sooner = bday('1990-11-14', { id: 'b', description: 'Sooner birthday' });
    const tie = bday('1990-11-14', { id: 'c', description: 'Tied anniversary' });
    const soonerText = `Sooner birthday on ${weekday(2026, 11, 14)}. A card or print would land well.`;
    expect(yearlyIdea([later, sooner], [], TODAY)).toBe(soonerText);
    expect(yearlyIdea([sooner, later], [], TODAY)).toBe(soonerText);
    expect(yearlyIdea([sooner, tie], [], TODAY)).toBe(soonerText);
    expect(yearlyIdea([bday('1990-11-12', { description: 'Today birthday' }), sooner], [], TODAY)).toBe(
      'Today birthday today. A card or print would land well.'
    );
  });

  it('skips dates outside the week and still picks one inside it', () => {
    const far = bday('1990-12-25', { description: 'Far birthday' });
    expect(yearlyIdea([far, bday('1990-11-13')], [], TODAY)).toBe('Birthday tomorrow. A card or print would land well.');
    expect(yearlyIdea([far], [], TODAY)).toBeNull();
  });

  it('stays quiet once settled by a touchpoint on the day or a dismissal that week', () => {
    expect(yearlyIdea([bday('1990-11-12')], [{ date: '2026-11-12' }], TODAY)).toBeNull();
    expect(yearlyIdea([bday('1990-11-14', { dismissedAt: '2026-11-08T12:00:00' })], [], TODAY)).toBeNull();
    expect(yearlyIdea([bday('1990-11-14')], [{ date: '2026-11-10' }], TODAY)).toBe(
      `Birthday on ${weekday(2026, 11, 14)}. A card or print would land well.`
    );
  });

  it('uses the real date when no today is given', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2027, 1, 27, 9, 0));
    expect(yearlyIdea([bday('2000-02-29')], [])).toBe('Birthday tomorrow. A card or print would land well.');
  });
});
