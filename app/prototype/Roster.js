'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { authFetch } from '../../lib/firebase';
import { useAuth } from '../_auth/AuthProvider';
import { usePrefs, setPref } from './prefs';
import {
  assertRosterEmailsUnique,
  createRosterMessageRequestId,
  normalizeRosterEmail,
  parseRosterCsv,
  rosterCsv,
  ROSTER_CSV_MAX_BYTES,
  ROSTER_CSV_MAX_ROWS,
  ROSTER_MAX_ENROLLMENTS,
} from './roster-utils';
import './roster.css';

/* Instructor · Class Roster (#64). Mock courses deliberately stay a clearly
   labelled local demo; real Coursewright records use the persisted roster API.
   Attendance, groups, seating charts, notes/flags, SIS, and other adjacent
   instructor tools are intentionally out of scope. */

const FIRST = ['James', 'Maria', 'Wei', 'Fatima', 'Diego', 'Aiko', 'Noah', 'Layla', 'Ethan', 'Zara', 'Marcus', 'Priya', 'Caleb', 'Amara', 'Liam', 'Sofia', 'Kenji', 'Grace', 'Omar', 'Nadia', 'Tyler', 'Mei', 'Jordan', 'Elena', 'Malik', 'Ines', 'Trevor', 'Yuki', 'Hassan', 'Chloe', 'Dario', 'Sana'];
const LAST = ['Torres', 'Patel', 'Kowalski', 'Silva', 'Haddad', 'Reyes', 'Nakamura', 'Osei', 'Marsh', 'Ibarra', 'Volkov', 'Abara', 'Petrov', 'Duarte', 'Kim', 'Bell', 'Farah', 'Chen', 'Okoye', 'Lindqvist'];
const RANKS = ['PFC', 'LCpl', 'Cpl', 'LCpl', 'PFC', 'Cpl'];
const DEFAULT_SECTIONS = ['A', 'B', 'C'];
const STATUS_LABEL = { active: 'Active', dropped: 'Dropped', waitlisted: 'Waitlisted' };

// Named individuals who already appear elsewhere in the prototype (Discussions
// seed data), so the mock roster agrees with the rest of the demo.
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
    section: DEFAULT_SECTIONS[i % DEFAULT_SECTIONS.length],
  }));
  for (let i = known.length; i < course.students; i += 1) {
    const first = FIRST[i % FIRST.length];
    const last = LAST[(i * 3 + 5) % LAST.length];
    const rank = RANKS[i % RANKS.length];
    out.push({
      id: `${course.id}-s${i}`,
      rank,
      name: `${rank} ${last}`,
      email: `${last.toLowerCase()}.${first[0].toLowerCase()}@usmc.mil`,
      section: DEFAULT_SECTIONS[i % DEFAULT_SECTIONS.length],
    });
  }
  return out.map((student) => ({ ...student, status: 'active' }));
}

function normaliseStudent(student, index) {
  return {
    ...student,
    id: String(student.id ?? `student-${index}`),
    name: String(student.name ?? ''),
    email: String(student.email ?? ''),
    section: String(student.section ?? ''),
    status: student.status || 'active',
  };
}

async function readApiError(response, fallback) {
  let body = null;
  try {
    body = await response.json();
  } catch {
    // Keep the HTTP status when the service did not send JSON.
  }
  if (!response.ok) {
    const message = body?.error || body?.message || `${fallback} (${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body || {};
}

async function rosterRequest(path, init = {}) {
  const response = await authFetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  return readApiError(response, 'Roster request failed');
}

function AddStudent({ sections, onCancel, onAdd }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [section, setSection] = useState(sections[0] || 'A');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      const saved = await onAdd({ name: name.trim(), email: email.trim(), section });
      if (saved) {
        setName('');
        setEmail('');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="s-ro-add">
      <div className="s-label">Add a student</div>
      <div className="s-ro-addrow">
        <input className="s-dq-input" style={{ fontSize: '0.95em', fontWeight: 400 }} placeholder="Name (e.g. LCpl Vance)" value={name} onChange={(event) => setName(event.target.value)} />
        <input className="s-dq-input" type="email" style={{ fontSize: '0.95em', fontWeight: 400 }} placeholder="Email" value={email} onChange={(event) => setEmail(event.target.value)} />
        <select className="s-dq-select" value={section} onChange={(event) => setSection(event.target.value)}>
          {sections.map((value) => <option key={value} value={value}>Section {value}</option>)}
        </select>
      </div>
      <div className="p-btnrow">
        <button className="p-btn" disabled={saving || !name.trim() || !email.trim()} onClick={submit}>
          {saving ? 'Saving…' : 'Add student'}
        </button>
        <button className="p-btn ghost" disabled={saving} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function ImportStudents({ onCancel, onImport }) {
  const [file, setFile] = useState(null);
  const [parsing, setParsing] = useState(false);
  const inputRef = useRef(null);

  const choose = async (event) => {
    const next = event.target.files?.[0] || null;
    setFile(next);
    if (!next) return;
    if (next.size > ROSTER_CSV_MAX_BYTES) {
      onImport(null, `CSV is too large. Maximum size is ${Math.round(ROSTER_CSV_MAX_BYTES / 1024 / 1024)} MB.`);
      return;
    }
    setParsing(true);
    try {
      const students = parseRosterCsv(await next.text(), { maxRows: ROSTER_CSV_MAX_ROWS });
      onImport(students);
    } catch (error) {
      onImport(null, error.message || 'Unable to parse CSV.');
    } finally {
      setParsing(false);
    }
  };

  return (
    <div className="s-ro-import">
      <div>
        <div className="s-label">Import roster CSV</div>
        <p className="s-ro-help">Required headers: <code>name</code>, <code>email</code>, <code>section</code>. Quoted fields and line breaks are supported; maximum {ROSTER_CSV_MAX_ROWS} students.</p>
      </div>
      <input ref={inputRef} type="file" accept=".csv,text/csv" onChange={choose} />
      {file && <span className="s-ro-file">{file.name}{parsing ? ' · checking…' : ''}</span>}
      <button className="p-btn ghost" disabled={parsing} onClick={onCancel}>Close</button>
    </div>
  );
}

function DropForm({ onCancel, onDrop }) {
  const [reason, setReason] = useState('withdrawn');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);

  const confirm = async () => {
    setSaving(true);
    try {
      const saved = await onDrop({ reason, date });
      if (!saved) setSaving(false);
    } catch {
      setSaving(false);
    }
  };

  return (
    <div className="s-ro-drop">
      <select className="s-dq-select small" value={reason} onChange={(event) => setReason(event.target.value)}>
        <option value="withdrawn">Withdrawn</option>
        <option value="failed">Failed / recycled</option>
        <option value="medical">Medical</option>
        <option value="administrative">Administrative</option>
      </select>
      <input className="s-dq-select small" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
      <button className="p-btn ghost" disabled={saving || !date} onClick={confirm}>{saving ? 'Saving…' : 'Confirm drop'}</button>
      <button className="p-btn ghost" disabled={saving} onClick={onCancel}>Cancel</button>
    </div>
  );
}

function Message({ recipientLabel, onCancel, onSent, demo }) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const requestIdRef = useRef(null);

  const submit = async () => {
    setSending(true);
    try {
      // Keep one id for retries of this composed message. A successful send
      // unmounts this composer; the next composer gets a new id.
      if (!requestIdRef.current) requestIdRef.current = createRosterMessageRequestId();
      const sent = await onSent({ subject: subject.trim(), body: body.trim(), requestId: requestIdRef.current });
      if (sent) {
        setSubject('');
        setBody('');
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="s-dq-new">
      <div className="s-label">{demo ? 'Local demo message' : 'Message'} · {recipientLabel}</div>
      <input className="s-dq-input" placeholder="Subject" value={subject} onChange={(event) => setSubject(event.target.value)} />
      <textarea rows={4} placeholder="Write your in-app message…" value={body} onChange={(event) => setBody(event.target.value)} />
      <div className="p-btnrow">
        <button className="p-btn" disabled={sending || !subject.trim() || !body.trim()} onClick={submit}>
          {sending ? 'Sending…' : demo ? 'Save local demo message' : 'Send in-app message'}
        </button>
        <button className="p-btn ghost" disabled={sending} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function exportRosterCsv(course, students) {
  const csv = rosterCsv(students, (status) => STATUS_LABEL[status] || status || '');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${course.id}_roster.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function RosterScreen({
  course,
  students,
  sections,
  loading,
  error,
  demo = false,
  onAdd,
  onImport,
  onStatus,
  onMessage,
}) {
  const [tab, setTab] = useState('active');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sectionFilter, setSectionFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('name');
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [dropId, setDropId] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [messaging, setMessaging] = useState(null);
  const [toast, setToast] = useState('');
  const [showAll, setShowAll] = useState(true);

  // A course change must never carry IDs into the next course. Prune again
  // after each server refresh so deleted/stale IDs cannot be submitted.
  useEffect(() => {
    setSelected(new Set());
    setDropId(null);
    setMessaging(null);
    setTab('active');
    setStatusFilter('all');
    setSectionFilter('all');
    setQuery('');
    setShowAll(true);
  }, [course.id]);

  useEffect(() => {
    const valid = new Set(students.map((student) => String(student.id)));
    setSelected((current) => {
      const next = new Set([...current].filter((id) => valid.has(String(id))));
      return next.size === current.size ? current : next;
    });
  }, [students]);

  const flash = useCallback((message) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 2800);
  }, []);

  const action = async (operation, successMessage) => {
    try {
      const saved = await operation();
      if (saved !== false) {
        if (successMessage) flash(successMessage);
        return true;
      }
    } catch (caught) {
      // Persisted callbacks usually set their own API error; local demo
      // validation throws so the exact duplicate/capacity reason is visible.
      if (caught?.message) flash(caught.message);
    }
    return false;
  };

  const counts = {
    active: students.filter((student) => student.status === 'active').length,
    dropped: students.filter((student) => student.status === 'dropped').length,
  };
  const activeStudents = students.filter((student) => student.status === 'active');

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = students
      .filter((student) => tab === 'all' || student.status === tab)
      .filter((student) => statusFilter === 'all' || student.status === statusFilter)
      .filter((student) => sectionFilter === 'all' || student.section === sectionFilter)
      .filter((student) => !needle || student.name.toLowerCase().includes(needle) || student.email.toLowerCase().includes(needle));
    return list.sort((a, b) => {
      if (sort === 'section') return a.section.localeCompare(b.section) || a.name.localeCompare(b.name);
      return a.name.localeCompare(b.name) || a.section.localeCompare(b.section);
    });
  }, [students, tab, statusFilter, sectionFilter, query, sort]);
  // Show-all is the default: real rosters must not silently stop at five.
  const visible = showAll ? filtered : filtered.slice(0, 5);
  const selectedActive = students.filter((student) => selected.has(String(student.id)) && student.status === 'active');
  const selectedNames = selectedActive.map((student) => student.name);
  const visibleIds = visible.map((student) => String(student.id));
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));

  const toggle = (id) => setSelected((current) => {
    const next = new Set(current);
    const value = String(id);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  });
  const toggleVisible = () => setSelected((current) => {
    const next = new Set(current);
    if (allVisibleSelected) visibleIds.forEach((id) => next.delete(id));
    else visibleIds.forEach((id) => next.add(id));
    return next;
  });

  const add = async (student) => {
    const saved = await action(() => onAdd(student), demo ? 'Student saved in this browser (demo only).' : 'Student added.');
    if (saved) setAdding(false);
    return saved;
  };
  const importRows = async (rows, parseError) => {
    if (parseError) {
      flash(parseError);
      return false;
    }
    if (!rows) return false;
    const saved = await action(() => onImport(rows), demo ? `${rows.length} students saved in this browser (demo only).` : `${rows.length} students imported.`);
    if (saved) setImporting(false);
    return saved;
  };
  const status = async (ids, payload, successMessage) => {
    const saved = await action(() => onStatus(ids, payload), successMessage);
    if (saved) {
      setSelected(new Set());
      setDropId(null);
    }
    return saved;
  };
  const send = async (payload) => {
    const ids = messaging?.ids || [];
    if (messaging?.all && ids.length > ROSTER_MAX_ENROLLMENTS) {
      flash(`Message all is limited to ${ROSTER_MAX_ENROLLMENTS} active students.`);
      return false;
    }
    const saved = await action(
      () => onMessage(ids, payload),
      demo ? 'Message saved locally for this demo course.' : 'Message delivered to in-app inbox.',
    );
    if (saved) {
      setMessaging(null);
      setSelected(new Set());
    }
    return saved;
  };

  return (
    <>
      <h2 className="p-h">Class Roster</h2>
      <p className="p-sub" title={`Course ID: ${course.id}`}>
        {course.name}.{!demo && ' Persisted roster for this course.'}
        {!demo && ` Limit ${ROSTER_MAX_ENROLLMENTS} enrolled records, including dropped records retained for history; imports max ${ROSTER_CSV_MAX_ROWS}.`}
      </p>
      {demo && <div className="s-ro-demo" role="status"><strong>LOCAL DEMO ONLY</strong> Changes stay in this browser, not sent to a live course.</div>}
      {error && <div className="s-ro-error" role="alert">{error}</div>}

      <div className="p-tiles">
        <div className="p-tile"><div className="p-tilelab">Active</div><div className="p-tileval">{counts.active}</div><div className="p-tilenote">enrolled</div></div>
        <div className="p-tile"><div className="p-tilelab">Dropped</div><div className="p-tileval" style={{ color: counts.dropped ? 'var(--p-warning)' : undefined }}>{counts.dropped}</div><div className="p-tilenote">kept for records</div></div>
        <div className="p-tile"><div className="p-tilelab">Sections</div><div className="p-tileval">{sections.length}</div><div className="p-tilenote">{sections.join(' · ') || '—'}</div></div>
        <div className="p-tile"><div className="p-tilelab">Selected</div><div className="p-tileval">{selectedActive.length}</div><div className="p-tilenote">active for message</div></div>
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
          <div className="s-ro-filters">
            <input className="s-dq-select small" aria-label="Search roster" placeholder="Search name or email…" value={query} onChange={(event) => setQuery(event.target.value)} />
            <select className="s-dq-select small" aria-label="Sort roster" value={sort} onChange={(event) => setSort(event.target.value)}>
              <option value="name">Sort: Name</option>
              <option value="section">Sort: Section</option>
            </select>
            <select className="s-dq-select small" aria-label="Filter by status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="all">Status: All</option>
              <option value="active">Status: Active</option>
              <option value="dropped">Status: Dropped</option>
            </select>
            <select className="s-dq-select small" aria-label="Filter by section" value={sectionFilter} onChange={(event) => setSectionFilter(event.target.value)}>
              <option value="all">Section: All</option>
              {sections.map((section) => <option key={section} value={section}>Section {section}</option>)}
            </select>
          </div>
          <div className="p-btnrow" style={{ margin: 0 }}>
            {selectedActive.length > 0 && <button className="p-btn ghost" onClick={() => setMessaging({ ids: selectedActive.map((student) => String(student.id)) })}>Message selected ({selectedActive.length})</button>}
             <button
               className="p-btn ghost"
               disabled={activeStudents.length === 0 || activeStudents.length > ROSTER_MAX_ENROLLMENTS}
               title={activeStudents.length > ROSTER_MAX_ENROLLMENTS ? `Messaging is limited to ${ROSTER_MAX_ENROLLMENTS} active students.` : undefined}
               onClick={() => setMessaging({ ids: activeStudents.map((student) => String(student.id)), all: true })}
             >
               Message all active
             </button>
            <button className="p-btn ghost" onClick={() => exportRosterCsv(course, students)}>Export CSV</button>
            {!adding && <button className="p-btn" onClick={() => setAdding(true)}>Add student</button>}
            {!importing && <button className="p-btn ghost" onClick={() => setImporting(true)}>Import CSV</button>}
          </div>
        </div>

        {adding && <AddStudent sections={sections} onCancel={() => setAdding(false)} onAdd={add} />}
        {importing && <ImportStudents onCancel={() => setImporting(false)} onImport={importRows} />}
        {messaging && (
          <Message
            key={`${messaging.all ? 'all' : 'selected'}:${messaging.ids.join(',')}`}
            demo={demo}
            recipientLabel={messaging.all ? `all ${counts.active} active students` : messaging.ids.length === 1 ? selectedNames[0] || '1 student' : `${messaging.ids.length} active students`}
            onCancel={() => setMessaging(null)}
            onSent={send}
          />
        )}

        {filtered.length > 5 && (
          <div className="s-ro-viewtoggle">
            Showing {showAll ? filtered.length : Math.min(5, filtered.length)} of {filtered.length} matching students.
            <button className="s-label-link" onClick={() => setShowAll((value) => !value)}>{showAll ? 'Show first 5' : 'Show all'}</button>
          </div>
        )}
        <div className="p-tablewrap" style={{ marginTop: '0.8rem' }}>
          <table className="p-table">
            <thead>
              <tr>
                <th style={{ width: '1.6rem' }}><input type="checkbox" aria-label="Select visible students" checked={allVisibleSelected} onChange={toggleVisible} disabled={loading || visible.length === 0} /></th>
                <th>Name</th><th>Email</th><th>Section</th><th>Status</th><th />
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={6} className="s-ro-state">Loading roster…</td></tr>}
              {!loading && visible.map((student) => (
                <tr key={student.id}>
                  <td><input type="checkbox" checked={selected.has(String(student.id))} onChange={() => toggle(student.id)} aria-label={`Select ${student.name}`} /></td>
                  <td>{student.name}</td>
                  <td style={{ color: 'var(--p-dim)' }}>{student.email}</td>
                  <td>{student.section}</td>
                  <td>
                    <span className={student.status === 'active' ? 's-dq-resolved' : student.status === 'dropped' ? 's-dq-un' : 's-dq-ans'}>{STATUS_LABEL[student.status] || student.status}</span>
                    {student.status === 'dropped' && (student.dropReason || student.effectiveDate || student.dropDate) && (
                      <div className="s-ro-dropmeta">{student.dropReason || '—'} · {student.effectiveDate || student.dropDate || '—'}</div>
                    )}
                  </td>
                  <td>
                    <div className="p-btnrow s-ro-rowactions">
                      {student.status === 'active' && <button className="p-btn ghost" onClick={() => setMessaging({ ids: [String(student.id)] })}>Message</button>}
                      {student.status === 'active' && dropId !== String(student.id) && <button className="p-btn ghost" onClick={() => setDropId(String(student.id))}>Drop</button>}
                      {student.status === 'dropped' && <button className="p-btn ghost" onClick={() => status([String(student.id)], { status: 'active', dropReason: null, effectiveDate: null }, 'Student reactivated.')}>Reactivate</button>}
                    </div>
                    {dropId === String(student.id) && <DropForm onCancel={() => setDropId(null)} onDrop={(value) => status([String(student.id)], { status: 'dropped', dropReason: value.reason, effectiveDate: value.date }, 'Student dropped and retained for records.')} />}
                  </td>
                </tr>
              ))}
              {!loading && visible.length === 0 && <tr><td colSpan={6} className="s-ro-state">No students match.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {toast && <div className="scw-toast">{toast}</div>}
    </>
  );
}

function useMockRoster(course, instructorName) {
  const prefs = usePrefs();
  const seed = useMemo(() => seedRoster(course), [course]);
  const local = prefs.roster?.[course.id] || { added: [], overrides: {} };
  const roster = useMemo(() => {
    const base = seed.map((student) => (local.overrides[student.id] ? { ...student, ...local.overrides[student.id] } : student));
    return [...local.added, ...base].map(normaliseStudent);
  }, [seed, local]);
  const save = (patch) => setPref(`roster.${course.id}`, { ...local, ...patch });
  const assertCanAdd = (students) => {
    assertRosterEmailsUnique(roster, students);
    if (roster.length + students.length > ROSTER_MAX_ENROLLMENTS) {
      throw new Error(`Roster limit is ${ROSTER_MAX_ENROLLMENTS} enrolled records, including dropped records.`);
    }
  };

  return {
    roster,
    sections: [...new Set(roster.map((student) => student.section).filter(Boolean))].sort() || DEFAULT_SECTIONS,
    add: async (student) => {
      const next = { ...student, email: normalizeRosterEmail(student.email), id: `new-${Date.now()}`, status: 'active' };
      assertCanAdd([next]);
      save({ added: [next, ...local.added] });
      return true;
    },
    importRows: async (students) => {
      const next = students.map((student, index) => ({
        ...student,
        email: normalizeRosterEmail(student.email),
        id: `import-${Date.now()}-${index}`,
        status: 'active',
      }));
      assertCanAdd(next);
      save({ added: next.concat(local.added) });
      return true;
    },
    status: async (ids, patch) => {
      const overrides = { ...local.overrides };
      ids.forEach((id) => { overrides[id] = { ...(overrides[id] || {}), ...patch }; });
      const added = local.added.map((student) => ids.includes(String(student.id)) ? { ...student, ...patch } : student);
      save({ overrides, added });
      return true;
    },
    message: async (ids, message) => {
      const recipients = roster.filter((student) => ids.includes(String(student.id))).map((student) => student.name);
      const localMessage = {
        id: `demo-inst-${Date.now()}`,
        from: instructorName || 'SSgt Okafor',
        role: 'Instructor',
        courseId: course.id,
        kind: 'announcement',
        subject: message.subject,
        body: message.body,
        when: 'Just now',
        unread: true,
        recipients,
        localOnly: true,
        actions: [{ label: `Open ${course.name}`, courseId: course.id, view: 'home' }],
      };
      setPref('inboxMessages', [localMessage, ...(prefs.inboxMessages || [])]);
      return true;
    },
  };
}

function MockRoster({ course, instructorName }) {
  const mock = useMockRoster(course, instructorName);
  return <RosterScreen course={course} students={mock.roster} sections={mock.sections.length ? mock.sections : DEFAULT_SECTIONS} demo onAdd={mock.add} onImport={mock.importRows} onStatus={mock.status} onMessage={mock.message} />;
}

function RealRoster({ course }) {
  const { ready, user } = useAuth();
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const requestRef = useRef(0);
  const courseRef = useRef(course.id);

  useEffect(() => {
    courseRef.current = course.id;
    requestRef.current += 1;
    setStudents([]);
    setError('');
    setLoading(true);
  }, [course.id]);

  const load = useCallback(async (signal) => {
    const requestId = ++requestRef.current;
    try {
      const result = await rosterRequest(`/api/roster/courses/${encodeURIComponent(course.id)}`, { signal });
      if (signal?.aborted || requestId !== requestRef.current || courseRef.current !== course.id) return false;
      setStudents(Array.isArray(result.students) ? result.students.map(normaliseStudent) : []);
      setError('');
      return true;
    } catch (caught) {
      if (caught?.name === 'AbortError' || signal?.aborted || requestId !== requestRef.current || courseRef.current !== course.id) return false;
      setError(caught.message || 'Unable to load the roster.');
      return false;
    } finally {
      if (!signal?.aborted && requestId === requestRef.current && courseRef.current === course.id) setLoading(false);
    }
  }, [course.id]);

  useEffect(() => {
    if (!ready) return undefined;
    if (!user) {
      setLoading(false);
      setError('Sign in with an instructor account to use the live roster.');
      return undefined;
    }
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [ready, user, load]);

  const mutate = async (method, payload) => {
    if (!user) {
      setError('Sign in with an instructor account to save roster changes.');
      return false;
    }
    const requestCourse = course.id;
    try {
      await rosterRequest(`/api/roster/courses/${encodeURIComponent(requestCourse)}`, {
        method,
        body: JSON.stringify(payload),
      });
      if (courseRef.current !== requestCourse) return false;
      await load();
      return true;
    } catch (caught) {
      if (courseRef.current === requestCourse) setError(caught.message || 'Unable to save roster changes.');
      return false;
    }
  };

  const add = (student) => mutate('POST', student);
  const importRows = (rows) => mutate('POST', { students: rows });
  const status = (ids, patch) => mutate('PATCH', { ids, ...patch });
  const message = async (ids, payload) => {
    if (!user) {
      setError('Sign in with an instructor account to send messages.');
      return false;
    }
    const requestCourse = course.id;
    try {
      const result = await rosterRequest(`/api/roster/courses/${encodeURIComponent(requestCourse)}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          studentIds: ids,
          subject: payload.subject,
          body: payload.body,
          requestId: payload.requestId,
        }),
      });
      if (courseRef.current !== requestCourse) return false;
      setError('');
      return Number(result.delivered) >= 0;
    } catch (caught) {
      if (courseRef.current === requestCourse) setError(caught.message || 'Unable to send the in-app message.');
      return false;
    }
  };

  const sections = [...new Set(students.map((student) => student.section).filter(Boolean))].sort();
  return <RosterScreen course={course} students={students} sections={sections.length ? sections : DEFAULT_SECTIONS} loading={loading} error={error} onAdd={add} onImport={importRows} onStatus={status} onMessage={message} />;
}

export function isRealRosterCourse(course) {
  return Boolean(course?.record);
}

export { createRosterMessageRequestId, parseRosterCsv, rosterCsv };

export default function Roster({ course, instructorName }) {
  return isRealRosterCourse(course) ? <RealRoster key={course.id} course={course} /> : <MockRoster key={course.id} course={course} instructorName={instructorName} />;
}
