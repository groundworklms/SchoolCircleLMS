/** Student dashboard greetings use the viewer's local clock, never server time. */
export function studentGreeting(date = new Date()) {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export function formatStudentGreeting(greeting, student) {
  const clean = (value) => typeof value === 'string' ? value.trim() : '';
  const name = clean(student?.name);
  const lastName = clean(student?.lastName) || name.split(/\s+/).filter(Boolean).at(-1) || '';
  const recipient = [clean(student?.rank), lastName].filter(Boolean).join(' ');
  return recipient ? `${greeting}, ${recipient}` : greeting;
}

export function subscribeStudentGreeting(onChange, windowTarget = window, documentTarget = document) {
  const refresh = () => onChange(studentGreeting());
  refresh();
  // Keep long-lived tabs current, including after sleep or a timezone change.
  const interval = setInterval(refresh, 60_000);
  windowTarget.addEventListener('focus', refresh);
  documentTarget.addEventListener('visibilitychange', refresh);
  return () => {
    clearInterval(interval);
    windowTarget.removeEventListener('focus', refresh);
    documentTarget.removeEventListener('visibilitychange', refresh);
  };
}