'use client';

import { useMemo, useState } from 'react';
import { COURSES } from './data';

/* Student calendar. Month grid + a day panel. Everything on it is mock —
   instructor-scheduled events, the generated study plan, and requirements —
   but the shape is what the real thing would render from the Schedule table. */

// The prototype's "today". Fixed so the demo looks the same on any date.
const TODAY = '2026-09-12';

// kind → how it's drawn. class/exam come from the instructor; plan from the
// generated study plan; todo is a student-owned item; req is a CY/FY/EPME requirement.
const KINDS = {
  class: { label: 'Class event', cls: 'class' },
  exam: { label: 'Exam', cls: 'exam' },
  plan: { label: 'Study plan', cls: 'plan' },
  todo: { label: 'To do', cls: 'todo' },
  req: { label: 'Requirement', cls: 'req' },
};

const FIXED = [
  // instructor-scheduled — Basic Electronics
  { date: '2026-09-14', time: '0800', title: 'Live session — Transmission Lines', kind: 'class', courseId: 'M092721', view: 'live', minutes: 50 },
  { date: '2026-09-16', time: '1300', title: 'Lab — SWR measurement', kind: 'class', courseId: 'M092721', minutes: 180 },
  { date: '2026-09-18', time: '0730', title: 'Block exam — Annex C', kind: 'exam', courseId: 'M092721', minutes: 120 },
  { date: '2026-09-21', time: '0730', title: 'Annex D begins — Fault Isolation', kind: 'class', courseId: 'M092721' },
  { date: '2026-09-25', time: '1300', title: 'Practice exam — Annex D', kind: 'class', courseId: 'M092721', view: 'materials', minutes: 90 },
  { date: '2026-10-02', time: '0730', title: 'Block exam — Annex D', kind: 'exam', courseId: 'M092721', minutes: 120 },
  // instructor-scheduled — Network Administrator
  { date: '2026-09-22', time: '0800', title: 'Radio net practical', kind: 'class', courseId: 'M09CVS1', minutes: 240 },
  { date: '2026-09-29', time: '0730', title: 'Block exam — Radio Fundamentals', kind: 'exam', courseId: 'M09CVS1', minutes: 90 },
  // student to-dos (same items the dashboard shows)
  { date: '2026-09-12', time: '1900', title: 'Practice set — Fault Isolation', kind: 'todo', courseId: 'M092721', view: 'materials', minutes: 30 },
  { date: '2026-09-13', time: '1000', title: 'Net entry procedure — reading', kind: 'todo', courseId: 'M09CVS1', view: 'lessons', minutes: 40 },
  { date: '2026-09-16', time: '1900', title: 'SWR calculation drill', kind: 'todo', courseId: 'M092721', view: 'materials', minutes: 30 },
  // requirements
  { date: '2026-09-10', time: '', title: 'FY safety standdown', kind: 'req', courseId: null, late: true, minutes: 45 },
  { date: '2026-10-04', time: '', title: 'CY range qualification — due', kind: 'req', courseId: null },
  { date: '2026-10-15', time: '', title: 'Annual cyber awareness — renew', kind: 'req', courseId: null },
];

// The "on track" study plan from Learning Path, repeated weekly through the block.
const PLAN = [
  { dow: 2, time: '1900', title: 'Spaced review — prior two blocks', minutes: 20 },
  { dow: 4, time: '1900', title: 'Practice set — 10 questions', minutes: 25, view: 'materials' },
  { dow: 0, time: '1000', title: 'Next-week preview + reading', minutes: 40, view: 'materials' },
];
const PLAN_RANGE = ['2026-09-13', '2026-10-11'];

/* ---------- date helpers (local, no library) ---------- */

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parse = (s) => new Date(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function longDate(s) {
  const d = parse(s);
  return `${DOW[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`;
}

function buildEvents() {
  const out = [...FIXED];
  const d = parse(PLAN_RANGE[0]);
  const end = parse(PLAN_RANGE[1]);
  while (d <= end) {
    const rule = PLAN.find((p) => p.dow === d.getDay());
    if (rule) out.push({ date: iso(d), kind: 'plan', courseId: 'M092721', ...rule });
    d.setDate(d.getDate() + 1);
  }
  return out.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}

/* ---------- component ---------- */

export default function StudentCalendar({ onOpen }) {
  const events = useMemo(buildEvents, []);
  const [cursor, setCursor] = useState(() => {
    const t = parse(TODAY);
    return { y: t.getFullYear(), m: t.getMonth() };
  });
  const [selected, setSelected] = useState(TODAY);
  const [hidden, setHidden] = useState(() => new Set());

  const byDate = useMemo(() => {
    const m = {};
    for (const e of events) (m[e.date] ||= []).push(e);
    return m;
  }, [events]);

  const visible = (e) => !hidden.has(e.kind);
  const toggleKind = (k) =>
    setHidden((h) => {
      const n = new Set(h);
      n.has(k) ? n.delete(k) : n.add(k);
      return n;
    });

  // 6-row grid starting on the Sunday on/before the 1st.
  const first = new Date(cursor.y, cursor.m, 1);
  const start = new Date(first);
  start.setDate(1 - first.getDay());
  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });

  const move = (n) => {
    const d = new Date(cursor.y, cursor.m + n, 1);
    setCursor({ y: d.getFullYear(), m: d.getMonth() });
  };

  const dayEvents = (byDate[selected] || []).filter(visible);
  const monthCount = events.filter((e) => e.date.startsWith(`${cursor.y}-${String(cursor.m + 1).padStart(2, '0')}`) && visible(e)).length;

  return (
    <div className="s-two s-cal-wrap">
      <div>
        <div className="s-pagehead s-cal-head">
          <div>
            <h1>Calendar</h1>
            <p>Class events from your instructors, study blocks from your plan, and requirements — in one place.</p>
          </div>
          <div className="p-btnrow">
            <button className="p-btn ghost">Push to Outlook</button>
            <button className="p-btn ghost">Text reminders</button>
          </div>
        </div>

        <div className="s-cal-bar">
          <div className="s-cal-nav">
            <button className="s-cal-arrow" onClick={() => move(-1)} aria-label="Previous month">‹</button>
            <span className="s-cal-month">{MONTHS[cursor.m]} {cursor.y}</span>
            <button className="s-cal-arrow" onClick={() => move(1)} aria-label="Next month">›</button>
            <button
              className="s-cal-today"
              onClick={() => {
                const t = parse(TODAY);
                setCursor({ y: t.getFullYear(), m: t.getMonth() });
                setSelected(TODAY);
              }}
            >
              Today
            </button>
          </div>
          <div className="s-cal-legend">
            {Object.entries(KINDS).map(([k, v]) => (
              <button
                key={k}
                className={`s-cal-key ${v.cls}${hidden.has(k) ? ' off' : ''}`}
                onClick={() => toggleKind(k)}
                aria-pressed={!hidden.has(k)}
              >
                <span className="s-cal-swatch" />
                {v.label}
              </button>
            ))}
            <span className="s-cal-count">{monthCount} this month</span>
          </div>
        </div>

        <div className="s-cal">
          {DOW.map((d) => (
            <div key={d} className="s-cal-dow">{d}</div>
          ))}
          {cells.map((d) => {
            const key = iso(d);
            const inMonth = d.getMonth() === cursor.m;
            const evs = (byDate[key] || []).filter(visible);
            const shown = evs.slice(0, 3);
            return (
              <button
                key={key}
                className={`s-cal-day${inMonth ? '' : ' out'}${key === TODAY ? ' today' : ''}${key === selected ? ' sel' : ''}${d.getDay() % 6 === 0 ? ' wknd' : ''}`}
                onClick={() => setSelected(key)}
              >
                <span className="s-cal-num">{d.getDate()}</span>
                <span className="s-cal-evs">
                  {shown.map((e, i) => (
                    <span key={i} className={`s-cal-chip ${KINDS[e.kind].cls}${e.late ? ' late' : ''}`} title={e.title}>
                      {e.time && <b>{e.time}</b>}
                      {e.title}
                    </span>
                  ))}
                  {evs.length > shown.length && <span className="s-cal-more">+{evs.length - shown.length} more</span>}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <aside className="s-agenda">
        <section className="s-box">
          <h4 className="s-label">{selected === TODAY ? 'Today' : 'Selected day'}</h4>
          <div className="s-cal-daytitle">{longDate(selected)}</div>
          {dayEvents.length === 0 ? (
            <p className="s-cal-empty">Nothing scheduled.</p>
          ) : (
            <ul className="s-list">
              {dayEvents.map((e, i) => (
                <li key={i}>
                  <span className={`s-cal-bar-mark ${KINDS[e.kind].cls}${e.late ? ' late' : ''}`} />
                  <button className="s-item" onClick={() => e.courseId && onOpen(e.courseId, e.view)}>
                    <span className="s-item-title">{e.title}</span>
                    <span className="s-item-meta">
                      {e.time ? `${e.time}` : 'All day'}
                      {e.minutes ? ` · ~${e.minutes} min` : ''}
                      {' · '}
                      {e.courseId ? <code>{COURSES[e.courseId].id}</code> : KINDS[e.kind].label}
                      {e.late && <span style={{ color: 'var(--p-critical)', fontWeight: 600 }}> · Overdue</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="s-box">
          <h4 className="s-label">This week's plan</h4>
          <p className="s-cal-note">
            Generated from the <b>on track</b> course of action on your Learning Path. Change the COA there and these
            blocks move with it.
          </p>
          <ul className="s-list">
            {PLAN.map((p) => (
              <li key={p.title}>
                <span className="s-cal-bar-mark plan" />
                <span className="s-item">
                  <span className="s-item-title">{p.title}</span>
                  <span className="s-item-meta">{DOW[p.dow]} {p.time} · {p.minutes} min</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      </aside>
    </div>
  );
}
