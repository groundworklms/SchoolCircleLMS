import Link from "next/link";

// The frosted-rail shell shared by every screen. `role` picks the nav + identity;
// `active` highlights the current nav item.
export default function Shell({ role = "LEARNER", active, title, subtitle, children }) {
  const isInstructor = role === "INSTRUCTOR";
  const who = isInstructor
    ? { name: "SSgt Instructor", role: "Instructor", initials: "SI" }
    : { name: "Cpl Learner", role: "Learner", initials: "CL" };

  const nav = isInstructor
    ? [
        { key: "studio", label: "Studio", href: "/studio" },
        { key: "learn", label: "View as learner", href: "/learn" },
      ]
    : [
        { key: "learn", label: "Learn", href: "/learn" },
        { key: "studio", label: "Instructor view", href: "/studio" },
      ];

  return (
    <div className="root">
      <nav className="rail">
        <div className="brand"><span className="dot" />SchoolCircle</div>
        <div className="rail-user">
          <div className="avatar">{who.initials}</div>
          <div className="rail-who">
            <div className="rail-name">{who.name}</div>
            <div className="rail-role">{who.role}</div>
          </div>
        </div>
        <div className="navlabel">Menu</div>
        {nav.map((n) => (
          <Link key={n.key} href={n.href} className={"navbtn" + (active === n.key ? " on" : "")}>
            {n.label}
          </Link>
        ))}
        <div className="rail-sp" />
        <div className="rail-foot">Grounded · Verified · Offline · Human-led</div>
      </nav>
      <div className="content">
        <main className="main">
          <div className="container">
            {(title || subtitle) && (
              <div className="pagehead">
                {title && <h1>{title}</h1>}
                {subtitle && <p>{subtitle}</p>}
              </div>
            )}
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
