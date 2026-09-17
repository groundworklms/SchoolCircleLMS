'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { authFetch } from '../../lib/firebase';
import { useAuth } from '../_auth/AuthProvider';
import './roster.css';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'unread', label: 'Unread' },
  { id: 'announcement', label: 'From instructors' },
  { id: 'reminder', label: 'Reminders' },
];

function formatServerDate(value) {
  if (!value) return 'Recently';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function serverMessage(message) {
  return {
    ...message,
    id: `roster-${message.id}`,
    serverId: message.id,
    from: message.senderName || 'Instructor',
    role: 'Instructor',
    courseId: null,
    courseName: message.courseName || '',
    kind: 'announcement',
    when: formatServerDate(message.createdAt),
    unread: !message.read,
  };
}

const EMPTY_INBOX = {
  messages: [],
  loading: false,
  error: '',
  live: false,
  ready: true,
  markRead: async () => false,
  removeMessage: async () => false,
};

function actorIdFor(user) {
  return user?.uid || user?.id || user?.email || user || null;
}

export function useRosterInbox(authState = null) {
  const auth = useAuth();
  const { ready, user } = authState || auth;
  const actorId = actorIdFor(user);
  const actorRef = useRef({ id: actorId, generation: 0 });
  if (actorRef.current.id !== actorId) {
    actorRef.current = {
      id: actorId,
      generation: actorRef.current.generation + 1,
    };
  }
  const requestRef = useRef(0);
  const accountGeneration = actorRef.current.generation;
  const [serverMessages, setServerMessages] = useState([]);
  const [messagesFor, setMessagesFor] = useState(null);
  const [loadingFor, setLoadingFor] = useState(null);
  const [errorFor, setErrorFor] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const requestId = ++requestRef.current;
    const controller = ready && user ? new AbortController() : null;
    const isCurrent = () => (
      requestRef.current === requestId
      && !controller?.signal.aborted
      && actorRef.current.id === actorId
      && actorRef.current.generation === accountGeneration
    );
    if (!ready || !user) {
      setServerMessages([]);
      setMessagesFor(null);
      setLoadingFor(null);
      setErrorFor(null);
      setError('');
      return undefined;
    }
    setLoadingFor(actorId);
    setErrorFor(null);
    setError('');
    authFetch('/api/roster/messages', { signal: controller.signal })
      .then(async (response) => {
        let body = null;
        try {
          body = await response.json();
        } catch {
          // readApiError below supplies a useful status for non-JSON errors.
        }
        if (!isCurrent()) return;
        if (!response.ok) throw new Error(body?.error || body?.message || `Unable to load inbox (${response.status})`);
        if (!Array.isArray(body?.messages)) throw new Error('Inbox service returned an invalid message list.');
        setServerMessages(body.messages.map(serverMessage));
        setMessagesFor(actorId);
      })
      .catch((caught) => {
        if (caught?.name === 'AbortError' || !isCurrent()) return;
        setServerMessages([]);
        setMessagesFor(actorId);
        setErrorFor(actorId);
        setError(caught.message || 'Unable to load your inbox.');
      })
      .finally(() => {
        if (isCurrent()) setLoadingFor(null);
      });
    return () => controller.abort();
  }, [ready, actorId, accountGeneration]);

  const messages = useMemo(() => {
    return ready && user && messagesFor === actorId ? serverMessages : [];
  }, [ready, user, actorId, messagesFor, serverMessages]);

  const markRead = useCallback(async (message) => {
    if (!message.unread) return true;
    try {
      const mutationGeneration = actorRef.current.generation;
      const mutationActor = actorRef.current.id;
      const current = () => (
        actorRef.current.id === mutationActor
        && actorRef.current.generation === mutationGeneration
      );
      const response = await authFetch('/api/roster/messages', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: message.serverId, read: true }),
      });
      let body = null;
      try {
        body = await response.json();
      } catch {
        // Preserve the status in the explicit error below.
      }
      if (!current()) return false;
      if (!response.ok) throw new Error(body?.error || body?.message || `Unable to mark message read (${response.status})`);
      setServerMessages((currentMessages) => currentMessages.map((item) => item.id === message.id ? { ...item, unread: false, read: true } : item));
      return true;
    } catch (caught) {
      const currentActor = actorRef.current.id === actorId
        && actorRef.current.generation === accountGeneration;
      if (!currentActor) return false;
      throw caught;
    }
  }, [actorId, accountGeneration]);

  // A recipient must be able to get rid of a message. The server scopes the
  // delete to the caller's own User row, so this can only remove that learner's
  // own copy.
  const removeMessage = useCallback(async (message) => {
    try {
      if (!user || !message.serverId) return false;
      const mutationGeneration = actorRef.current.generation;
      const mutationActor = actorRef.current.id;
      const current = () => (
        actorRef.current.id === mutationActor
        && actorRef.current.generation === mutationGeneration
      );
      const response = await authFetch('/api/roster/messages', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: message.serverId }),
      });
      let body = null;
      try {
        body = await response.json();
      } catch {
        // Preserve the status in the explicit error below.
      }
      if (!current()) return false;
      if (!response.ok) throw new Error(body?.error || body?.message || `Unable to delete message (${response.status})`);
      setServerMessages((currentMessages) => currentMessages.filter((item) => item.id !== message.id));
      return true;
    } catch (caught) {
      const currentActor = actorRef.current.id === actorId
        && actorRef.current.generation === accountGeneration;
      if (!currentActor) return false;
      throw caught;
    }
  }, [actorId, accountGeneration, user]);

  return {
    messages,
    loading: Boolean(user && loadingFor === actorId),
    error: errorFor === actorId ? error : '',
    live: Boolean(user),
    ready,
    markRead,
    removeMessage,
  };
}

export default function StudentInbox({ onOpen, onArea, inbox = EMPTY_INBOX }) {
  const { messages: msgs, loading, error, live, ready, markRead, removeMessage } = inbox;
  const [filter, setFilter] = useState('all');
  const [selectedId, setSelectedId] = useState(null);
  const [reply, setReply] = useState('');
  const [readError, setReadError] = useState('');

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
    setReadError('');
    const message = msgs.find((item) => item.id === id);
    if (message?.unread) {
      markRead(message).catch((caught) => setReadError(caught.message || 'Unable to mark this message read.'));
    }
  };

  const act = (a) => {
    if (a.area) onArea(a.area);
    else onOpen(a.courseId, a.view);
  };

  const removeMsg = (message) => {
    setReadError('');
    removeMessage(message)
      .then((removed) => {
        if (removed) setSelectedId((current) => (current === message.id ? null : current));
      })
      .catch((caught) => setReadError(caught.message || 'Unable to delete this message.'));
  };

  return (
    <div className="s-inbox-wrap">
      <div className="s-pagehead s-cal-head">
        <div>
          <h1>Inbox</h1>
          <p>{unreadCount === 0 ? 'Nothing unread.' : `${unreadCount} unread.`}</p>
        </div>
        <div className="s-inbox-filters">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" className={filter === f.id ? 'on' : ''} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label}
              {f.id === 'unread' && unreadCount > 0 && <span className="s-inbox-pill">{unreadCount}</span>}
            </button>
          ))}
        </div>
      </div>
      {ready && !live && !loading && <div className="s-ro-state" role="status"><strong>Sign in required.</strong> View your instructor messages.</div>}
      {loading && <div className="s-ro-state" role="status">Loading your inbox…</div>}
      {error && <div className="s-ro-error" role="alert">{error}</div>}
      {readError && <div className="s-ro-error" role="alert">{readError}</div>}

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
                  {m.courseName ? <span className="s-msg-kind">{m.courseName}</span> : <span className="s-msg-kind">{m.role}</span>}
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
                  {(selected.courseId || selected.courseName) && (
                    <>
                      {' · '}
                       {selected.courseName}
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
            {(selected.actions?.length > 0 || selected.serverId) && (
            <div className="p-btnrow s-read-actions">
              {(selected.actions || []).map((a) => (
                <button key={a.label} className="p-btn" onClick={() => act(a)}>
                  {a.label}
                </button>
              ))}
              {selected.serverId && (
                <button className="p-btn ghost" onClick={() => removeMsg(selected)}>
                  Delete
                </button>
              )}
            </div>
            )}
            {selected.kind === 'announcement' && (
              <div className="s-reply">
                <textarea
                  aria-label={`Reply to ${selected.from}`}
                  placeholder={`Reply to ${selected.from}…`}
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  rows={3}
                />
                <div className="p-btnrow">
                  <button className="p-btn ghost" disabled={!reply.trim()} onClick={() => setReply('')}>
                    Send
                  </button>
                  <span className="s-reply-note">To the instructor only, never the class.</span>
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
