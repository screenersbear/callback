// A returning visitor for the button clicker: Callback keeps "welcomed" and
// everyone in its own database (IndexedDB), not localStorage, so this saves
// a few made-up people through the app's own db.js before the page reloads.
// Between them they bring up every kind of card: overdue, a reply to check,
// a promise, their news, light touch, parked, the dream list.
export const SEED_IDS = {
  one: 'seed-person-one',
  two: 'seed-person-two',
};

export async function seed(page) {
  await page.evaluate(async (ids) => {
    const db = await import('/js/db.js');
    const day = (n) => {
      const d = new Date();
      d.setDate(d.getDate() + n);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    const ago = (n) => new Date(Date.now() - n * 864e5).toISOString();
    const org = await db.saveOrganization({ id: 'seed-org', name: 'Test Studio', type: 'agency' });
    const circle = await db.saveCircle({ id: 'seed-circle', name: 'Test circle', order: 0 });
    const person = (id, name, more) => db.savePerson({
      id, name, role: 'Producer', organizationId: org.id, circleIds: [circle.id],
      relationshipTypes: ['client'], relationshipType: 'client', interest: 'open',
      createdAt: ago(120), ...more,
    });
    await person(ids.one, 'Test Person One', { warmth: 'warm', nextTouchpointDate: day(-3), howWeMet: 'A test shoot' });
    await person(ids.two, 'Test Person Two', { warmth: 'cold', relationshipTypes: ['prospect'], relationshipType: 'prospect', nextTouchpointDate: day(5) });
    await person('seed-person-three', 'Test Person Three', { warmth: 'parked', nextTouchpointDate: day(60) });
    await person('seed-person-four', 'Test Person Four', { warmth: 'warm', lightTouch: true, nextTouchpointDate: day(0) });
    await person('seed-person-five', 'Test Person Five', { warmth: 'cold', dreamList: true, nextTouchpointDate: null });
    await db.saveTouchpoint({ id: 'seed-tp-1', personId: ids.one, type: 'email', date: day(-40), note: 'Sent the test link', responded: 'yes', respondedAt: ago(39), interest: 'open', replyNote: 'Thanks, looks good' });
    await db.saveTouchpoint({ id: 'seed-tp-2', personId: ids.two, type: 'email', date: day(-6), note: 'A test hello', responded: 'pending', respondedAt: null });
    await db.saveOpenLoop({ id: 'seed-loop', personId: ids.one, touchpointId: 'seed-tp-1', direction: 'iOwe', description: 'Send the test prints', dueDate: day(-1), status: 'open', closedAt: null });
    await db.saveNews({ id: 'seed-news', personId: ids.one, description: 'Test premiere', date: day(2), repeatsYearly: false });
    await db.setMeta('welcomed', new Date().toISOString());
  }, SEED_IDS);
}
