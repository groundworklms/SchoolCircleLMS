'use client';

import AuthGuard from '../_auth/AuthGuard';
import Prototype from './Prototype';

/* The whole prototype renders from the layout, which Next keeps mounted while
   the URL changes underneath it. That is what lets the chat panel, open
   modules and scroll position survive navigation. The catch-all page below
   renders nothing; the URL is the state.

   AuthGuard gates this behind Firebase auth when it's configured, and is a
   no-op (fully open) when it isn't — so the app is never locked out. */
export default function PrototypeLayout() {
  return (
    <AuthGuard>
      <Prototype />
    </AuthGuard>
  );
}
