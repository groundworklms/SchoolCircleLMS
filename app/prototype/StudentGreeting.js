'use client';

import { useEffect, useState } from 'react';
import { subscribeStudentGreeting } from './student-greeting';

export default function StudentGreeting() {
  // Match server HTML during hydration; resolve browser-local time on mount.
  const [greeting, setGreeting] = useState(null);
  useEffect(() => subscribeStudentGreeting(setGreeting), []);
  return <span>{greeting || '\u00a0'}</span>;
}