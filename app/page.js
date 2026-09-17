import Link from 'next/link';
import './landing.css';

const PRINCIPLES = [
  ['Grounded', 'Every answer cites the exact paragraph of doctrine — or the system refuses. It never invents.'],
  ['Verified', 'An on-device entailment check confirms the specifics are actually supported by the source.'],
  ['Offline', 'The delivery loop runs on a Jetson at the edge with the network pulled. $0 per answer.'],
  ['Human-led', 'AI drafts; an instructor approves, edits, or rejects. Nothing unreviewed reaches a student.'],
];

export default function Landing() {
  return (
    <div className="scl-page">
      <nav className="scl-nav">
        <div className="scl-brand">
          <span className="scl-mark">S</span> SchoolCircle
        </div>
        <div className="scl-nav-spacer" />
        <Link className="scl-btn scl-btn-ghost" href="/login">Sign in</Link>
      </nav>

      <div className="scl-wrap">
        <header className="scl-hero">
          <span className="scl-eyebrow">Grounded · Verified · Offline · Human-led</span>
          <h1>Training that cannot make things up.</h1>
          <p className="scl-sub">
            SchoolCircle is a grounded, offline, human-led learning platform. Every answer cites the
            manual or refuses — so what Marines learn is what the doctrine actually says.
          </p>
          {/* One way in, and it is honest about being one way in. The second
              button used to point at /prototype, which is auth-gated and bounces
              straight to /login?next=/prototype -- so it promised a guest tour
              that does not exist and delivered the primary button twice. There is
              no public tour to link to yet, so the secondary CTA points at the
              one thing this page can actually show a signed-out visitor. */}
          <div className="scl-cta">
            <Link className="scl-btn scl-btn-primary" href="/login">Sign in to the prototype →</Link>
            <a className="scl-btn scl-btn-ghost" href="#how-it-works">See how it works ↓</a>
          </div>
        </header>

        <section className="scl-principles">
          {PRINCIPLES.map(([h, p]) => (
            <div className="scl-principle" key={h}>
              <h3><span className="scl-dot" />{h}</h3>
              <p>{p}</p>
            </div>
          ))}
        </section>

        <section className="scl-what" id="how-it-works">
          <h2>One grounded loop, end to end</h2>
          <p>
            Instructors build cited courses from doctrine and approve every item. Learners study, ask
            a tutor that answers only from the source, and get calibrated by confidence versus
            correctness. Instructors see where the class is weak — never any one Marine's answers.
          </p>
        </section>

        <footer className="scl-foot">
          SchoolCircle · a Groundwork project · grounded, verified, offline, human-led.
        </footer>
      </div>
    </div>
  );
}
