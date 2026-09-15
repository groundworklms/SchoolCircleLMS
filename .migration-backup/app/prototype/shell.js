'use client';

import { useEffect, useRef, useState } from 'react';

/* Pieces both shells (student and instructor) are built from. */

/* ---------- icons (inline so nothing new to install) ---------- */

const I = {
  dashboard: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="8" height="8" rx="1.5" /><rect x="13" y="3" width="8" height="5" rx="1.5" />
      <rect x="13" y="11" width="8" height="10" rx="1.5" /><rect x="3" y="14" width="8" height="7" rx="1.5" />
    </svg>
  ),
  courses: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" /><path d="M8 3v18" /><path d="M12 8h5M12 12h5" />
    </svg>
  ),
  calendar: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  ),
  inbox: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12l3-7h12l3 7v7a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" /><path d="M3 12h5l2 3h4l2-3h5" />
    </svg>
  ),
  swap: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h13l-3-3M20 17H7l3 3" />
    </svg>
  ),
  back: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 12H5M11 6l-6 6 6 6" />
    </svg>
  ),
};

function RailButton({ icon, label, on, onClick, badge, sub }) {
  return (
    <button className={`s-rail-btn${on ? ' on' : ''}${sub ? ' sub' : ''}`} onClick={onClick} title={label}>
      {icon ? <span className="s-rail-ico">{icon}</span> : null}
      <span className="s-rail-lab">{label}</span>
      {badge ? <span className="s-rail-badge">{badge}</span> : null}
    </button>
  );
}


/* User block at the top of the rail. Click opens a small menu. */
function UserMenu({ name, role, initials, inst, items }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="s-rail-user-wrap" ref={ref}>
      <button className={`s-rail-user${open ? ' open' : ''}`} onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
        <div className={`s-avatar${inst ? ' inst' : ''}`}>{initials}</div>
        <div className="s-rail-who">
          <div className="s-rail-name">{name}</div>
          <div className="s-rail-role">{role}</div>
        </div>
        <span className="s-rail-chev">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="s-menu" role="menu">
          <div className="s-menu-head">
            <div className="s-menu-name">{name}</div>
            <div className="s-menu-sub">Signed in via MCeLE</div>
          </div>
          {items.map((it, i) =>
            it === 'divider' ? (
              <div className="s-menu-div" key={i} />
            ) : (
              <button
                key={it.label}
                className={`s-menu-item${it.danger ? ' danger' : ''}`}
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  it.onClick();
                }}
              >
                {it.label}
                {it.hint && <span className="s-menu-hint">{it.hint}</span>}
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}

export { I, RailButton, UserMenu };
