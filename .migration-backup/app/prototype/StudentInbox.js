'use client';

import { useState } from 'react';
import { COURSES } from './data';

/* Student inbox. Message list + reading pane. Everything here is mock — the
   point is what lands in a Marine's inbox: instructor announcements, reminders
   the platform generates from the plan, and requirement notices. */

const MESSAGES = [
  {
    id: 1,
    from: 'SSgt Okafor',
    role: 'Instructor',
    courseId: 'M092721',
    kind: 'announcement',
    subject: 'Block exam Friday — what to expect',
    when: 'Today 0715',
    unread: true,
    body: `Marines,

The Annex C block exam is Friday at 0730 in Room 114. 40 items, two hours, closed book. It covers Transmission Lines and Test Equipment — Fault Isolation is NOT on this one; it starts Monday.

Class-wide, the practice sets are showing the same miss on SWR: you're using the raw power ratio instead of taking the square root first. If you have not done the SWR drill on your Study Materials, do it before Wednesday's lab.

Bring a pencil and your calculator. No phones on the desk.

SSgt Okafor`,
    actions: [{ label: 'Open SWR drill', courseId: 'M092721', view: 'materials' }],
  },
  {
    id: 2,
    from: 'SchoolCircle',
    role: 'Reminder',
    courseId: null,
    kind: 'reminder',
    subject: 'FY safety standdown is overdue',
    when: 'Today 0600',
    unread: true,
    body: `Your FY safety standdown was due 10 Sep and is not complete.

This is an annual requirement auto-enrolled from your unit's training plan. It takes about 45 minutes. Your chain of command can see completion status.`,
    actions: [{ label: 'View required training', area: 'courses' }],
  },
  {
    id: 3,
    from: 'SchoolCircle',
    role: 'Study plan',
    courseId: 'M092721',
    kind: 'reminder',
    subject: 'Tonight 1900 — Practice set, Fault Isolation (30 min)',
    when: 'Today 0500',
    unread: false,
    body: `Your on-track plan has a 30-minute practice set tonight at 1900.

Fault Isolation is your weakest topic at 48%. This set is 12 adaptive questions weighted toward the items you have missed before. Each answer comes with the reason it is right or wrong.

Change your course of action on Learning Path if the plan is not working for your schedule.`,
    actions: [{ label: 'Start practice set', courseId: 'M092721', view: 'materials' }],
  },
  {
    id: 4,
    from: 'GySgt Flores',
    role: 'Chief Instructor',
    courseId: 'M092721',
    kind: 'announcement',
    subject: 'Lab schedule change — Wednesday',
    when: 'Yesterday 1540',
    unread: false,
    body: `All hands,

Wednesday's SWR measurement lab moves from 0800 to 1300 due to equipment availability. Same room. The morning block will be classroom time on Test Equipment.

Calendar has been updated.

GySgt Flores`,
    actions: [{ label: 'Open calendar', area: 'calendar' }],
  },
  {
    id: 5,
    from: 'Sgt Delgado',
    role: 'Instructor',
    courseId: 'M09CVS1',
    kind: 'announcement',
    subject: 'Radio net practical — grading sheet attached',
    when: 'Thu 1105',
    unread: false,
    body: `Marines,

The grading sheet for the 22 Sep radio net practical is attached to the course. Read it before you show up. You are graded on net entry procedure, proword usage, and authentication — in that order of weight.

Net entry is the one people fumble under time pressure. The reading on your plan for Sunday covers it.

Sgt Delgado`,
    actions: [{ label: 'Open Network Administrator', courseId: 'M09CVS1', view: 'home' }],
  },
  {
    id: 6,
    from: 'SchoolCircle',
    role: 'Progress',
    courseId: 'M092721',
    kind: 'reminder',
    subject: 'Weekly progress — Basic Electronics',
    when: 'Sun 1800',
    unread: false,
    body: `Week 5 summary.

Overall mastery: 77% (+4 from last week).
Strongest: Safety & PPE, 95%.
Needs work: Fault Isolation, 48%. Transmission Lines, 62%.
Practice sets completed: 3 of 3 planned.

You are on track. Your plan for week 6 front-loads Fault Isolation ahead of Annex D.`,
    actions: [{ label: 'View my progress', courseId: 'M092721', view: 'progress' }],
  },
  {
    id: 7,
    from: 'MCeLE',
    role: 'System',
    courseId: null,
    kind: 'system',
    subject: 'Enrollment confirmed — Sergeants Course (EPME)',
    when: '2 Sep',
    unread: false,
    body: `You have been enrolled in the Sergeants Course distance education program based on your rank and time in grade.

No action is required now. The course appears under Required training and will be added to your plan when you start it.`,
    actions: [{ label: 'View required training', area: 'courses' }],
  },
];

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'unread', label: 'Unread' },
  { id: 'announcement', label: 'From instructors' },
  { id: 'reminder', label: 'Reminders' },
];

export default function StudentInbox({ onOpen, onArea }) {
  const [msgs, setMsgs] = useState(MESSAGES);
  const [filter, setFilter] = useState('all');
  const [selectedId, setSelectedId] = useState(null);
  const [reply, setReply] = useState('');

  const visible = msgs.filter((m) => {
    if (filter === 'all') return true;
    if (filter === 'unread') return m.unread;
    return m.kind === filter;
  });
  const selected = msgs.find((m) => m.id === selectedId);
  const unreadCount = msgs.filter((m) => m.unread).length;

  const openMsg = (id) => {
    setSelectedId(id);
    setReply('');
    setMsgs((ms) => ms.map((m) => (m.id === id ? { ...m, unread: false } : m)));
  };

  const act = (a) => {
    if (a.area) onArea(a.area);
    else onOpen(a.courseId, a.view);
  };

  return (
    <div className="s-inbox-wrap">
      <div className="s-pagehead s-cal-head">
        <div>
          <h1>Inbox</h1>
          <p>
            {unreadCount === 0 ? 'Nothing unread.' : `${unreadCount} unread.`} Instructor announcements, reminders from your
            plan, and requirement notices.
          </p>
        </div>
        <div className="s-inbox-filters">
          {FILTERS.map((f) => (
            <button key={f.id} className={filter === f.id ? 'on' : ''} onClick={() => setFilter(f.id)}>
              {f.label}
              {f.id === 'unread' && unreadCount > 0 && <span className="s-inbox-pill">{unreadCount}</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="s-inbox">
        <ul className="s-msglist">
          {visible.length === 0 && <li className="s-msg-empty">No messages here.</li>}
          {visible.map((m) => (
            <li key={m.id}>
              <button
                className={`s-msg${m.unread ? ' unread' : ''}${selected && selected.id === m.id ? ' sel' : ''}`}
                onClick={() => openMsg(m.id)}
              >
                <span className="s-msg-top">
                  <span className="s-msg-from">{m.from}</span>
                  <span className="s-msg-when">{m.when}</span>
                </span>
                <span className="s-msg-subject">{m.subject}</span>
                <span className="s-msg-meta">
                  {m.courseId ? <code>{COURSES[m.courseId].id}</code> : <span className="s-msg-kind">{m.role}</span>}
                  {m.courseId && <span className="s-msg-kind"> · {m.role}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>

        {selected ? (
          <article className="s-read">
            <header className="s-read-head">
              <div className="s-read-avatar">{selected.from.split(' ').map((w) => w[0]).slice(0, 2).join('')}</div>
              <div className="s-read-who">
                <div className="s-read-from">
                  {selected.from} <span>· {selected.role}</span>
                </div>
                <div className="s-read-meta">
                  {selected.when}
                  {selected.courseId && (
                    <>
                      {' · '}
                      <code>{COURSES[selected.courseId].id}</code> {COURSES[selected.courseId].name}
                    </>
                  )}
                </div>
              </div>
            </header>
            <h2 className="s-read-subject">{selected.subject}</h2>
            <div className="s-read-body">
              {selected.body.split('\n\n').map((para, i) => (
                <p key={i}>
                  {para.split('\n').map((line, j) => (
                    <span key={j}>
                      {line}
                      {j < para.split('\n').length - 1 && <br />}
                    </span>
                  ))}
                </p>
              ))}
            </div>
            {selected.actions?.length > 0 && (
              <div className="p-btnrow s-read-actions">
                {selected.actions.map((a) => (
                  <button key={a.label} className="p-btn" onClick={() => act(a)}>
                    {a.label}
                  </button>
                ))}
              </div>
            )}
            {selected.kind === 'announcement' && (
              <div className="s-reply">
                <textarea
                  placeholder={`Reply to ${selected.from}…`}
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  rows={3}
                />
                <div className="p-btnrow">
                  <button className="p-btn ghost" disabled={!reply.trim()} onClick={() => setReply('')}>
                    Send
                  </button>
                  <span className="s-reply-note">Replies go to the instructor only — never to the class.</span>
                </div>
              </div>
            )}
          </article>
        ) : (
          <article className="s-read s-read-empty">Select a message to read it.</article>
        )}
      </div>
    </div>
  );
}
