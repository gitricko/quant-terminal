// Pure state logic for the collapsible right sidebar (ADR 0001 §Consequences).
// Zero DOM/window/localStorage at module scope so `node --test` can import it.
// Key strings and defaults live here; panels.js is the thin DOM wiring layer.

export const VALID_TABS = ['watchlist', 'alerts', 'calendar', 'news'];
export const DEFAULT_TAB = 'watchlist';
export const COLLAPSED_KEY = 'qt-side-collapsed';
export const DRAWER_KEY = 'qt-side-drawer-open';
export const MOBILE_QUERY = '(max-width: 900px)';

// Read the persisted collapsed flag. Only the literal string "1" means
// collapsed; anything else (missing key, "0", garbage) degrades to false.
// Null storage or a throwing storage (private mode) returns false.
export function readCollapsed(storage) {
  if (!storage) return false;
  try {
    return storage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

// Read the persisted active tab. Returns the stored id only if it is one of
// `known`; missing, empty, unknown, or null storage falls back to DEFAULT_TAB.
export function readTab(storage, known = VALID_TABS) {
  if (!storage) return DEFAULT_TAB;
  try {
    const stored = storage.getItem('qt-side-tab');
    return known.includes(stored) ? stored : DEFAULT_TAB;
  } catch {
    return DEFAULT_TAB;
  }
}

// Persist the collapsed flag as "1"/"0". Never throws; returns true on
// success, false when storage is absent or setItem rejects. Does NOT touch
// the drawer key (the drawer is a per-session transient, ADR Decision #4).
export function writeCollapsed(storage, value) {
  if (!storage) return false;
  try {
    storage.setItem(COLLAPSED_KEY, value ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}

// matchMedia wrapper: a falsy mq (node test context) is simply "not mobile".
export function isMobile(mq) {
  if (!mq) return false;
  return Boolean(mq.matches);
}

// Project raw state into the class/attribute booleans panels.js applies.
// Collapse is a DESKTOP-ONLY persisted affordance (ADR v5/v6): on mobile the
// 36px rail is the baseline driven by the media query, so `collapsed` never
// produces the `.side.collapsed` class below the breakpoint.
export function project({ collapsed = false, isMobile = false, drawerOpen = false } = {}) {
  const collapsedClass = collapsed && !isMobile;
  const bodyVisible = isMobile ? drawerOpen : !collapsed;
  return {
    collapsedClass,
    drawerClass: drawerOpen,
    bodyVisible,
    ariaExpanded: isMobile ? drawerOpen : !collapsed,
    sideBodyHidden: !bodyVisible,
  };
}

// Pure reducer over {activeTab, collapsed, drawerOpen}.
// 'select:<tab>' switches the tab and leaves the drawer (and the desktop
// flag) alone — a tap in the mobile rail never closes the drawer
// (round-6 contract, ADR v8). The live DOM path is panels.js
// selectSideTab(); this reducer locks the state rules it applies.
export function reduce(state, event) {
  switch (event) {
    case 'toggle':
      return { ...state, collapsed: !state.collapsed };
    case 'openDrawer':
      return { ...state, drawerOpen: true };
    case 'closeDrawer':
      return { ...state, drawerOpen: false };
    default: {
      if (event.startsWith('select:')) {
        const tab = event.slice('select:'.length);
        if (VALID_TABS.includes(tab)) {
          return { ...state, activeTab: tab };
        }
      }
      return state;
    }
  }
}
