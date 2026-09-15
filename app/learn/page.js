import Shell from "@/app/_components/Shell";
import { prisma } from "@/lib/db";
import { sampleCourse } from "@/lib/sample";

export const dynamic = "force-dynamic";

async function loadCourse() {
  // Throws if the DB isn't set up yet -> caller falls back to sample mode.
  const course = await prisma.course.findFirst({
    include: { sections: { orderBy: { order: "asc" }, include: { items: true } } },
  });
  if (!course) throw new Error("no course seeded");
  return course;
}

function citeText(c) {
  if (!c) return null;
  return typeof c === "string" ? c : c.citation || null;
}

export default async function LearnPage() {
  let course;
  let sample = false;
  try {
    course = await loadCourse();
  } catch {
    course = sampleCourse;
    sample = true;
  }

  // A learner only ever sees APPROVED items — the human-in-the-loop guardrail.
  const sections = (course.sections || [])
    .map((s) => ({ ...s, items: (s.items || []).filter((i) => i.status === "APPROVED") }))
    .filter((s) => s.items.length);

  return (
    <Shell
      role="LEARNER"
      active="learn"
      title={course.title}
      subtitle={`Grounded in ${course.sourceId} — every claim cites the manual, or the tutor refuses.`}
    >
      {sample && (
        <div className="banner">
          Sample mode — the database isn&apos;t set up yet. Run{" "}
          <code>docker compose up -d &amp;&amp; npm run db:migrate &amp;&amp; npm run db:seed</code> to see live data.
        </div>
      )}

      <div className="tree">
        {sections.map((s, i) => (
          <section className="mod" key={s.id}>
            <div className="mod-h">
              <span className="mod-letter">{String.fromCharCode(65 + i)}</span>
              {s.title}
              <span className="mod-count">{s.items.length} items</span>
            </div>
            <div className="mod-items">
              {s.items.map((it) => (
                <article className="item" key={it.id}>
                  <div className="item-top">
                    <span className="item-kind">{it.kind}</span>
                    {citeText(it.citation) && <span className="cite">{citeText(it.citation)}</span>}
                  </div>
                  <div className="txt">{it.stem}</div>
                  {it.kind === "QUESTION" && Array.isArray(it.options) && (
                    <ul className="opts">
                      {it.options.map((opt, oi) => (
                        <li key={oi}>{String.fromCharCode(65 + oi)}. {opt}</li>
                      ))}
                    </ul>
                  )}
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
    </Shell>
  );
}
