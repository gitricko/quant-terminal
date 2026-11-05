import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  VALID_TABS, DEFAULT_TAB, COLLAPSED_KEY, DRAWER_KEY, MOBILE_QUERY,
  readCollapsed, readTab, writeCollapsed, isMobile, project, reduce,
} from '../public/lib/sidebar-state.js';

// Small in-memory stand-in for localStorage (getItem/setItem only).
function fakeStorage(entries = {}) {
  const map = new Map(Object.entries(entries));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    dump: () => Object.fromEntries(map),
  };
}

test('exports the expected key strings and tab list', () => {
  assert.deepEqual(VALID_TABS, ['watchlist', 'alerts', 'calendar', 'news']);
  assert.equal(DEFAULT_TAB, 'watchlist');
  assert.equal(COLLAPSED_KEY, 'qt-side-collapsed');
  assert.equal(DRAWER_KEY, 'qt-side-drawer-open');
  assert.equal(MOBILE_QUERY, '(max-width: 900px)');
});

test('readCollapsed: only the literal "1" collapses', () => {
  assert.equal(readCollapsed(fakeStorage({ [COLLAPSED_KEY]: '1' })), true);
  assert.equal(readCollapsed(fakeStorage({ [COLLAPSED_KEY]: '0' })), false);
  assert.equal(readCollapsed(fakeStorage({ [COLLAPSED_KEY]: 'banana' })), false);
  assert.equal(readCollapsed(fakeStorage()), false);
  assert.equal(readCollapsed(null), false);
  assert.equal(readCollapsed(undefined), false);
  const throwing = { getItem() { throw new Error('private mode'); } };
  assert.equal(readCollapsed(throwing), false);
});

test('readTab: valid stored id wins; missing/empty/unknown/null fall back to default', () => {
  assert.equal(readTab(fakeStorage({ 'qt-side-tab': 'alerts' })), 'alerts');
  assert.equal(readTab(fakeStorage({ 'qt-side-tab': 'news' })), 'news');
  assert.equal(readTab(fakeStorage()), DEFAULT_TAB);
  assert.equal(readTab(fakeStorage({ 'qt-side-tab': '' })), DEFAULT_TAB);
  assert.equal(readTab(fakeStorage({ 'qt-side-tab': 'banana' })), DEFAULT_TAB);
  assert.equal(readTab(null), DEFAULT_TAB);
  const throwing = { getItem() { throw new Error('private mode'); } };
  assert.equal(readTab(throwing), DEFAULT_TAB);
});

test('writeCollapsed: writes "1"/"0" to the collapsed key, returns truth value', () => {
  const s = fakeStorage();
  assert.equal(writeCollapsed(s, true), true);
  assert.equal(s.getItem(COLLAPSED_KEY), '1');
  assert.equal(s.getItem(DRAWER_KEY), null, 'must not touch the drawer key');
  assert.equal(writeCollapsed(s, false), true);
  assert.equal(s.getItem(COLLAPSED_KEY), '0');
  assert.equal(s.getItem(DRAWER_KEY), null);
  const s0 = fakeStorage({ [COLLAPSED_KEY]: '1' });
  assert.equal(writeCollapsed(s0, 0), true);
  assert.equal(s0.getItem(COLLAPSED_KEY), '0');
  assert.equal(writeCollapsed(null, true), false);
  assert.equal(writeCollapsed(undefined, true), false);
  const throwing = { setItem() { throw new Error('quota'); } };
  assert.equal(writeCollapsed(throwing, true), false);
});

test('isMobile: falsy mq is false without throwing, otherwise Boolean(matches)', () => {
  assert.equal(isMobile(null), false);
  assert.equal(isMobile(undefined), false);
  assert.equal(isMobile({ matches: true }), true);
  assert.equal(isMobile({ matches: false }), false);
});

test('project: desktop default — expanded', () => {
  const p = project();
  assert.deepEqual(p, {
    collapsedClass: false,
    drawerClass: false,
    bodyVisible: true,
    ariaExpanded: true,
    sideBodyHidden: false,
  });
});

test('project: desktop collapsed', () => {
  assert.deepEqual(project({ collapsed: true }), {
    collapsedClass: true,
    drawerClass: false,
    bodyVisible: false,
    ariaExpanded: false,
    sideBodyHidden: true,
  });
});

test('project: KEY RULE — mobile ignores the persisted collapsed flag', () => {
  const p = project({ collapsed: true, isMobile: true });
  assert.equal(p.collapsedClass, false, 'no .collapsed class below the breakpoint');
  assert.equal(p.bodyVisible, false, 'collapsed flag is inert on mobile: drawer closed');
});

test('project: mobile drawer open drives visibility', () => {
  const p = project({ collapsed: true, isMobile: true, drawerOpen: true });
  assert.equal(p.collapsedClass, false);
  assert.equal(p.drawerClass, true);
  assert.equal(p.bodyVisible, true);
  assert.equal(p.ariaExpanded, true);
  assert.equal(p.sideBodyHidden, false);
});

test('reduce: toggle flips collapsed, leaves tab/drawer alone', () => {
  const s0 = { activeTab: 'alerts', collapsed: false, drawerOpen: true };
  const s1 = reduce(s0, 'toggle');
  assert.deepEqual(s1, { activeTab: 'alerts', collapsed: true, drawerOpen: true });
  assert.equal(reduce(s1, 'toggle').collapsed, false);
});

test('reduce: openDrawer / closeDrawer', () => {
  const s0 = { activeTab: 'watchlist', collapsed: false, drawerOpen: false };
  assert.equal(reduce(s0, 'openDrawer').drawerOpen, true);
  assert.equal(reduce(reduce(s0, 'openDrawer'), 'closeDrawer').drawerOpen, false);
  assert.equal(reduce(s0, 'openDrawer').collapsed, false);
});

test('reduce: select:<tab> sets tab and LEAVES the drawer open (ADR v8 contract)', () => {
  const s0 = { activeTab: 'watchlist', collapsed: false, drawerOpen: true };
  const s1 = reduce(s0, 'select:calendar');
  assert.deepEqual(s1, { activeTab: 'calendar', collapsed: false, drawerOpen: true });
  const s2 = reduce(s1, 'select:news');
  assert.equal(s2.activeTab, 'news');
  assert.equal(s2.drawerOpen, true, 'drawer stays open on tab switch');
  assert.equal(s2.collapsed, false, 'desktop flag untouched either');
});

test('reduce: unknown or invalid events return state unchanged', () => {
  const s0 = { activeTab: 'alerts', collapsed: true, drawerOpen: true };
  assert.equal(reduce(s0, 'bogus'), s0, 'same reference for unknown event');
  assert.equal(reduce(s0, 'select:banana'), s0, 'invalid tab left untouched');
  assert.equal(reduce(s0, 'select:'), s0);
  assert.deepEqual(reduce(s0, 'select:calendar'), { activeTab: 'calendar', collapsed: true, drawerOpen: true });
});
