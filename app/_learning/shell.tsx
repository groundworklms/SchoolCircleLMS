"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

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

export function RailButton({
  icon,
  label,
  on,
  onClick,
  badge,
  sub,
}: {
  icon?: ReactNode;
  label: string;
  on?: boolean;
  onClick: () => void;
  badge?: number | string | null;
  sub?: boolean;
}) {
  return (
    <button className={`s-rail-btn${on ? " on" : ""}${sub ? " sub" : ""}`} onClick={onClick} title={label}>
      {icon ? <span className="s-rail-ico">{icon}</span> : null}
      <span className="s-rail-lab">{label}</span>
      {badge ? <span className="s-rail-badge">{badge}</span> : null}
    </button>
  );
}

export function UserMenu({
  name,
  role,
  initials,
  inst,
  items,
}: {
  name: string;
  role: string;
  initials: string;
  inst?: boolean;
  items: Array<"divider" | {
    label: string;
    hint?: string;
    danger?: boolean;
    onClick: () => void;
  }>;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="s-rail-user-wrap" ref={ref}>
      <button
        className={`s-rail-user${open ? " open" : ""}`}
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <div className={`s-avatar${inst ? " inst" : ""}`}>{initials}</div>
        <div className="s-rail-who">
          <div className="s-rail-name">{name}</div>
          <div className="s-rail-role">{role}</div>
        </div>
        <span className="s-rail-chev">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className="s-menu" role="menu">
          <div className="s-menu-head">
            <div className="s-menu-name">{name}</div>
            <div className="s-menu-sub">Signed in via MCeLE</div>
          </div>
          {items.map((item, index) =>
            item === "divider" ? (
              <div className="s-menu-div" key={index} />
            ) : (
              <button
                key={item.label}
                className={`s-menu-item${item.danger ? " danger" : ""}`}
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  item.onClick();
                }}
              >
                {item.label}
                {item.hint && <span className="s-menu-hint">{item.hint}</span>}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

export { I };