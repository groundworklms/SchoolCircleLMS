'use client';

import Prototype from './Prototype';

/* The whole prototype renders from the layout, which Next keeps mounted while
   the URL changes underneath it. That is what lets the chat panel, open
   modules and scroll position survive navigation. The catch-all page below
   renders nothing; the URL is the state. */
export default function PrototypeLayout() {
  return <Prototype />;
}
