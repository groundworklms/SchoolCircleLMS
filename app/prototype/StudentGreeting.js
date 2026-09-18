'use client';

import { useEffect, useState } from 'react';
import { formatStudentGreeting, subscribeStudentGreeting } from './student-greeting';

export default function StudentGreeting({ student }) {
  // Match server HTML during hydration; resolve browser-local time on mount.
  const [greeting, setGreeting] = useState(null);
  useEffect(() => subscribeStudentGreeting(setGreeting), []);
  return <span>{greeting ? formatStudentGreeting(greeting, student) : '\u00a0'}</span>;
}