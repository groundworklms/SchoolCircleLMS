'use client';

import { createContext, useContext } from 'react';

/* The tour is started from the account menu in each shell, but its state has to
 * live above both shells -- the script crosses from instructor to student and
 * back, and the overlay must survive that switch. So the provider owns the
 * state (see Walkthrough.js) and the shells only ask it to start.
 *
 * `start` is null when the tour is unavailable for this account, which lets a
 * shell leave the menu item out rather than offering something that would
 * immediately dead-end.
 */
export const WalkthroughContext = createContext({
  start: null,
  running: false,
  scriptLabel: null,
});

export function useWalkthrough() {
  return useContext(WalkthroughContext);
}
