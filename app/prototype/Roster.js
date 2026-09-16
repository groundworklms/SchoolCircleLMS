'use client';

import { useMemo, useState } from 'react';
import { usePrefs, setPref } from './prefs';

/* Instructor · Class Roster (#64). Core roster management for one course:
   view, add, drop/reactivate, search/sort/filter, message, and export.
   Groups, attendance, seating charts, notes/flags, and SIS/CSV import are
   deliberately out of scope for this pass — see the PR description. */

const FIRST = ['James', 'Maria', 'Wei', 'Fatima', 'Diego', 'Aiko', 'Noah', 'Layla', 'Ethan', 'Zara', 'Marcus', 'Priya', 'Caleb', 'Amara', 'Liam', 'Sofia', 'Kenji', 'Grace', 'Omar', 'Nadia', 'Tyler', 'Mei', 'Jordan', 'Elena', 'Malik', 'Ines', 'Trevor', 'Yuki', 'Hassan', 'Chloe', 'Dario', 'Sana'];
const LAST = ['Torres', 'Patel', 'Kowalski', 'Silva', 'Haddad', 'Reyes', 'Nakamura', 'Osei', 'Marsh', 'Ibarra', 'Volkov', 'Abara', 'Petrov', 'Duarte', 'Kim', 'Bell', 'Farah', 'Chen', 'Okoye', 'Lindqvist'];
const RANKS = ['PFC', 'LCpl', 'Cpl', 'LCpl', 'PFC', 'Cpl'];
const SECTIONS = ['A', 'B', 'C'];

// Named individuals who already appear elsewhere in the prototype (Discussions
// seed data), so the roster agrees with the rest of the demo instead of
// introducing strangers.
const KNOWN = {
  M092721: [
    { rank: 'Cpl', last: 'Rivera', first: 'J' },
    { rank: 'LCpl', last: 'Nguyen', first: 'T' },
    { rank: 'PFC', last: 'Adeyemi', first: 'K' },
  ],
  M09CVS1: [{ rank: 'Cpl', last: 'Rivera', first: 'J' }],
};

function seedRoster(course) {
  const known = KNOWN[course.id] || [];
  const out = known.map((k, i) => ({
    id: `${course.id}-known${i}`,
    rank: k.rank,
    name: `${k.rank} ${k.last}`,
    email: `${k.last.toLowerCase()}.${k.first.toLowerCase()}@usmc.mil`,
    section: SECTIONS[i % SECTIONS.length],
  }));
  for (let i = known.length; i < course.students; i++) {
    const first = FIRST[i % FIRST.length];
    const last = LAST[(i * 3 + 5) % LAST.length];
    const rank = RANKS[i % RANKS.length];
    out.push({
      id: `${course.id}-s${i}`,
      rank,
      name: `${rank} ${last}`,
      email: `${last.toLowerCase()}.${first[0].toLowerCase()}@usmc.mil`,
      section: SECTIONS[i % SECTIONS.length],
    });
  }
  return out.map((s) => ({ ...s, status: 'active' }));
}

function useRoster(course) {
  const prefs = usePrefs();
  const seed = useMemo(() => seedRoster(course), [course]);
  const local = prefs.roster?.[course.id] || { added: [], overrides: {} };
  const roster = useMemo(() => {
    const base = seed.map((s) => (local.overrides[s.id] ? { ...s, ...local.overrides[s.id] } : s));
    return [...local.added, ...base];
  }, [seed, local]);
  const save = (patch) => setPref(`roster.${course.id}`, { ...local, ...patch });
  return { roster, local, save };
}

const STATUS_LABEL = { active: 'Active', dropped: 'Dropped', waitlisted: 'Waitlisted' };

function AddStudent({ onCancel, onAdd }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [section, setSection] = useState('A');
  return (
    <div className="s-ro-add">
      <div className="s-label">Add a student</div>
      <div className="s-ro-addrow">
        <input className="s-dq-input" style={{ fontSize: '0.95em', fontWeight: 400 }} placeholder="Name (e.g. LCpl Vance)" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="s-dq-input" style={{ fontSize: '0.95em', fontWeight: 400 }} placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <select className="s-dq-select" value={section} onChange={(e) => setSection(e.target.value)}>
          {SECTIONS.map((s) => <option key={s} value={s}>Section {s}</option>)}
        </select>
      </div>
      <div className="p-btnrow">
        <button
          className="p-btn"
          disabled={!name.trim() || !email.trim()}
          onClick={() => { onAdd({ name: name.trim(), email: email.trim(), section }); setName(''); setEmail(''); }}
        >
          Add student
        </button>
        <button className="p-btn ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function DropForm({ onCancel, onDrop }) {
  const [reason, setReason] = useState('withdrawn');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  return (
    <div className="s-ro-drop">
      <select className="s-dq-select small" value={reason} onChange={(e) => setReason(e.target.value)}>
        <option value="withdrawn">Withdrawn</option>
        <option value="failed">Failed / recycled</option>
        <option value="medical">Medical</option>
        <option value="administrative">Administrative</option>
      </select>
      <input className="s-dq-select small" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      <button className="p-btn ghost" onClick={() => onDrop({ reason, date })}>Confirm drop</button>
      <button className="p-btn ghost" onClick={onCancel}>Cancel</button>
    </div>
  );
}

function Message({ names, onCancel, onSent }) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  return (
    <div className="s-dq-new">
      <div className="s-label">Message {names.length === 1 ? names[0] : `${names.length} students`}</div>
      <input className="s-dq-input" placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
      <textarea rows={4} placeholder="Write your message…" value={body} onChange={(e) => setBody(e.target.value)} />
      <div className="p-btnrow">
        <button className="p-btn" disabled={!subject.trim() || !body.trim()} onClick={() => onSent({ subject: subject.trim(), body: body.trim() })}>Send to email &amp; inbox</button>
        <button className="p-btn ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function exportCsv(course, roster) {
  const rows = [['Name', 'Email', 'Section', 'Status'], ...roster.map((s) => [s.name, s.email, s.section, STATUS_LABEL[s.status] || s.status])];
  const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${course.id}_roster.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function Roster({ course, instructorName = 'SSgt Okafor' }) {
  const prefs = usePrefs();
  const { roster, local, save } = useRoster(course);
  const [tab, setTab] = useState('active');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('name');
  const [adding, setAdding] = useState(false);
  const [dropId, setDropId] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [messaging, setMessaging] = useState(false);
  const [toast, setToast] = useState('');

  const setOverride = (id, patch) => save({ overrides: { ...local.overrides, [id]: { ...(local.overrides[id] || {}), ...patch } } });
  const addStudent = ({ name, email, section }) => {
    const s = { id: `new-${Date.now()}`, name, email, section, status: 'active' };
    save({ added: [s, ...local.added] });
    setAdding(false);
  };
  const drop = (id, { reason, date }) => {
    setOverride(id, { status: 'dropped', dropReason: reason, dropDate: date });
    setDropId(null);
  };
  const reactivate = (id) => setOverride(id, { status: 'active', dropReason: null, dropDate: null });

  const shown = roster
    .filter((s) => (tab === 'all' ? true : s.status === tab))
    .filter((s) => !q.trim() || s.name.toLowerCase().includes(q.toLowerCase()) || s.email.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (sort === 'section' ? a.section.localeCompare(b.section) || a.name.localeCompare(b.name) : a.name.localeCompare(b.name)));

  const counts = { active: roster.filter((s) => s.status === 'active').length, dropped: roster.filter((s) => s.status === 'dropped').length };
  const toggle = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selectedNames = roster.filter((s) => selected.has(s.id)).map((s) => s.name);

  const flash = (msg) => { setToast(msg); setTimeout(() => setToast(''), 2600); };

  return (
    <>
      <h2 className="p-h">Class Roster</h2>
      <p className="p-sub">{course.name} · {course.id}. Add, drop, and message students for this course.</p>

      <div className="p-tiles">
        <div className="p-tile">
          <div className="p-tilelab">Active</div>
          <div className="p-tileval">{counts.active}</div>
          <div className="p-tilenote">enrolled</div>
        </div>
        <div className="p-tile">
          <div className="p-tilelab">Dropped</div>
          <div className="p-tileval" style={{ color: counts.dropped ? 'var(--p-warning)' : undefined }}>{counts.dropped}</div>
          <div className="p-tilenote">kept for records</div>
        </div>
        <div className="p-tile">
          <div className="p-tilelab">Sections</div>
          <div className="p-tileval">{SECTIONS.length}</div>
          <div className="p-tilenote">A · B · C</div>
        </div>
        <div className="p-tile">
          <div className="p-tilelab">Selected</div>
          <div className="p-tileval">{selected.size}</div>
          <div className="p-tilenote">for bulk message</div>
        </div>
      </div>

      <div className="p-panel">
        <h3>
          Roster
          <span style={{ float: 'right' }}>
            <span className="p-diff">
              {[['active', `Active${counts.active ? ` (${counts.active})` : ''}`], ['dropped', `Dropped${counts.dropped ? ` (${counts.dropped})` : ''}`], ['all', 'All']].map(([id, label]) => (
                <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}</button>
              ))}
            </span>
          </span>
        </h3>

        <div className="s-dq-bar">
          <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
            <input className="s-dq-select small" placeholder="Search name or email…" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: '14rem' }} />
            <select className="s-dq-select small" value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="name">Sort: Name</option>
              <option value="section">Sort: Section</option>
            </select>
          </div>
          <div className="p-btnrow" style={{ margin: 0 }}>
            {selected.size > 0 && <button className="p-btn ghost" onClick={() => setMessaging(true)}>Message selected ({selected.size})</button>}
            <button className="p-btn ghost" onClick={() => exportCsv(course, roster)}>Export CSV</button>
            {!adding && <button className="p-btn" onClick={() => setAdding(true)}>Add student</button>}
          </div>
        </div>

        {adding && <AddStudent onCancel={() => setAdding(false)} onAdd={addStudent} />}
        {messaging && (
          <Message
            names={selectedNames}
            onCancel={() => setMessaging(false)}
            onSent={({ subject, body }) => {
              const msg = {
                id: `inst-${Date.now()}`,
                from: instructorName,
                role: 'Instructor',
                courseId: course.id,
                kind: 'announcement',
                subject,
                body,
                when: 'Just now',
                unread: true,
                recipients: selectedNames,
                actions: [{ label: `Open ${course.name}`, courseId: course.id, view: 'home' }],
              };
              setPref('inboxMessages', [msg, ...(prefs.inboxMessages || [])]);
              setMessaging(false);
              setSelected(new Set());
              flash('Message sent to email & in-app inbox.');
            }}
          />
        )}

        <div className="p-tablewrap" style={{ marginTop: '0.8rem' }}>
          <table className="p-table">
            <thead>
              <tr>
                <th style={{ width: '1.6rem' }} />
                <th>Name</th>
                <th>Email</th>
                <th>Section</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((s) => (
                <tr key={s.id}>
                  <td><input type="checkbox" checked={selected.has(s.id)} onChange={() => toggle(s.id)} /></td>
                  <td>{s.name}</td>
                  <td style={{ color: 'var(--p-dim)' }}>{s.email}</td>
                  <td>{s.section}</td>
                  <td>
                    <span className={s.status === 'active' ? 's-dq-resolved' : s.status === 'dropped' ? 's-dq-un' : 's-dq-ans'}>
                      {STATUS_LABEL[s.status] || s.status}
                    </span>
                    {s.status === 'dropped' && s.dropDate && (
                      <div style={{ fontSize: '0.75em', color: 'var(--p-faint)', marginTop: '0.2rem' }}>{s.dropReason} · {s.dropDate}</div>
                    )}
                  </td>
                  <td>
                    <div className="p-btnrow" style={{ margin: 0, justifyContent: 'flex-end' }}>
                      <button className="p-btn ghost" style={{ height: '2rem', fontSize: '0.82em' }} onClick={() => { setSelected(new Set([s.id])); setMessaging(true); }}>Message</button>
                      {s.status === 'active' && dropId !== s.id && (
                        <button className="p-btn ghost" style={{ height: '2rem', fontSize: '0.82em' }} onClick={() => setDropId(s.id)}>Drop</button>
                      )}
                      {s.status === 'dropped' && (
                        <button className="p-btn ghost" style={{ height: '2rem', fontSize: '0.82em' }} onClick={() => reactivate(s.id)}>Reactivate</button>
                      )}
                    </div>
                    {dropId === s.id && <DropForm onCancel={() => setDropId(null)} onDrop={(v) => drop(s.id, v)} />}
                  </td>
                </tr>
              ))}
              {shown.length === 0 && (
                <tr><td colSpan={6} style={{ color: 'var(--p-faint)', textAlign: 'center', padding: '1.2rem' }}>No students match.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {toast && <div className="scw-toast">{toast}</div>}
    </>
  );
}

export default Roster;
