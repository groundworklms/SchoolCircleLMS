'use client';

/* The live view of a course being written.

   Fed by /api/learning/courses/draft/stream, which reports every phase and
   every artifact as it lands. This renders what the server said happened and
   nothing else: a refused artifact shows the reason it was refused rather than
   a generic failure, and an objective the sources do not cover is shown as
   skipped rather than quietly dropped. */

const ARTIFACTS = [
  { kind: 'lesson', label: 'Lesson' },
  { kind: 'diagram', label: 'Diagram' },
  { kind: 'pre-test', label: 'Pre-check' },
  { kind: 'post-test', label: 'Post-check' },
  { kind: 'flashcards', label: 'Cards' },
  { kind: 'pages', label: 'Pages' },
];

const APPLY = [
  { kind: 'scenario', label: 'Applied scenario' },
  { kind: 'discussion', label: 'Discussion prompts' },
  { kind: 'summary', label: 'Instructor summary' },
];

/** Fold the event stream into what the screen draws. Pure: same events in, same view out. */
export function generationView(events) {
  const view = {
    documents: 0,
    characters: 0,
    outline: 'waiting',
    repairs: [],
    objectives: [],
    title: '',
    total: 0,
    // How many source passages ground the whole course, summed over its
    // sections. A section may be grounded in more than one, so this is not the
    // section count and the screen must not imply it is.
    passages: 0,
    sections: [],
    skipped: [],
    // The outline reached only a slice of a large source, and the server said
    // so. Never inferred here: the ratio behind it needs the source's size in
    // characters, which only the generation side has.
    thinCoverage: false,
    apply: {},
    done: false,
    pages: 'waiting',
    saved: null,
    failure: null,
  };
  const byTitle = new Map();
  /* Grounding is reported before generation starts, so a section can be named
     by a `grounded` event before its `section` event arrives. */
  const sectionFor = (title) => {
    if (!byTitle.has(title)) {
      const section = { title, passages: 0, artifacts: {} };
      byTitle.set(title, section);
      view.sections.push(section);
    }
    return byTitle.get(title);
  };
  /* A section the server dropped is not a section of this course. Take it out
     of the list being drawn and name it under "not covered" instead, with the
     others the sources never reached: two stages of the same outcome, reported
     once so the count above the list keeps matching the list. */
  const dropSection = (title) => {
    const section = byTitle.get(title);
    if (!section) return;
    byTitle.delete(title);
    view.sections = view.sections.filter((entry) => entry !== section);
  };
  for (const event of Array.isArray(events) ? events : []) {
    if (event.phase === 'sources') {
      view.documents = event.documents || 0;
      view.characters = event.characters || 0;
    } else if (event.phase === 'outline') {
      /* An objective taken out because an earlier one already says it. It is a
         fourth way into the same list the retrieval skips and the generator
         refusals feed -- the course does not cover this, and here is why -- and
         the only one that is a judgement about the request rather than about
         the sources, which is exactly what its reason says. */
      if (event.step === 'restated') {
        view.skipped.push({
          objective: String(event.section || ''),
          reason: String(event.reason || ''),
        });
      }
      if (event.status === 'start') view.outline = 'running';
      if (event.status === 'repair') {
        view.outline = 'repairing';
        view.repairs = event.issues || [];
      }
      if (event.status === 'done') {
        view.outline = 'done';
        view.objectives = event.objectives || [];
        /* Source topics the outline deliberately left outside the course. They
           arrive a stage earlier than the retrieval skips and the generator
           refusals below, but they read as the same fact to an instructor --
           the course does not cover this -- so they join the same list rather
           than getting a second one. Their reason is what keeps them apart. */
        for (const entry of Array.isArray(event.notCovered) ? event.notCovered : []) {
          const objective = String(entry?.objective || '');
          if (objective) view.skipped.push({ objective, reason: String(entry?.reason || '') });
        }
        view.thinCoverage = event.thinCoverage === true;
      }
    } else if (event.phase === 'title') {
      view.title = event.title || '';
      // The title check reports after every section exists, so it arrives on
      // this phase long after the title itself did. It does not replace the
      // title; it says which of its words nothing under it delivers.
      if (Array.isArray(event.notTaught) && event.notTaught.length > 0) {
        view.titleNotTaught = event.notTaught;
      }
    } else if (event.phase === 'sections') {
      view.total = event.total || 0;
      view.passages = event.passages || 0;
    } else if (event.phase === 'coursewright') {
      if (event.step === 'skipped') {
        view.skipped.push({ objective: event.section, reason: event.reason || '' });
      } else if (event.step === 'dropped') {
        dropSection(event.section);
        view.skipped.push({ objective: event.section, reason: event.reason || '' });
      } else if (event.step === 'grounded') {
        sectionFor(event.section).passages = event.passages || 0;
      } else if (event.step === 'section') {
        sectionFor(event.section);
      } else if (event.step === 'done') {
        view.done = true;
      } else if (event.kind && event.section) {
        const section = byTitle.get(event.section);
        if (section) section.artifacts[event.kind] = { ok: event.ok, reason: event.reason };
      } else if (event.kind) {
        view.apply[event.kind] = { ok: event.ok, reason: event.reason };
      }
    } else if (event.phase === 'pages') {
      // The page pass runs after Coursewright, one section at a time, and
      // reports the same way: an ok per section, or the reason it refused.
      if (event.status === 'start') view.pages = 'running';
      if (event.status === 'done') view.pages = 'done';
      // Keyed on event.kind, the same way the coursewright branch is. This
      // pass emits more than one kind now -- 'pages' for the write itself and
      // 'item-support' for items the written pages cannot answer -- and
      // hardcoding 'pages' made the second overwrite the first.
      if (event.kind && event.section) {
        const section = byTitle.get(event.section);
        if (section) {
          section.artifacts[event.kind] = {
            ok: event.ok,
            reason: event.reason,
            ...(event.items ? { items: event.items } : {}),
          };
        }
      }
    } else if (event.phase === 'saved') {
      view.saved = event.record || null;
    } else if (event.phase === 'failed') {
      view.failure = event;
    }
  }
  return view;
}

/* Skipped topics by the reason they were skipped, in first-seen order.
   Grouping moves the reason out of every row and into one heading, which is
   what makes a list of twelve readable -- and it turns a repeated clause into
   the thing it actually is, a category. */
export function skippedByReason(skipped) {
  const groups = new Map();
  for (const entry of Array.isArray(skipped) ? skipped : []) {
    const objective = String(entry?.objective || '').trim();
    if (!objective) continue;
    const reason = String(entry?.reason || '').trim() || 'not covered';
    if (!groups.has(reason)) groups.set(reason, []);
    if (!groups.get(reason).includes(objective)) groups.get(reason).push(objective);
  }
  return [...groups.entries()].map(([reason, objectives]) => ({ reason, objectives }));
}

function Chip({ label, state, reason }) {
  const colour = state === undefined
    ? 'var(--p-faint)'
    : state
      ? 'var(--p-good)'
      : 'var(--p-warning)';
  return (
    <span
      title={reason || undefined}
      style={{
        fontSize: '0.74em',
        fontWeight: 600,
        border: `1px solid ${colour}`,
        color: colour,
        borderRadius: '980px',
        padding: '0.1em 0.6em',
        whiteSpace: 'nowrap',
        opacity: state === undefined ? 0.45 : 1,
      }}
    >
      {state === false ? `${label} - skipped` : label}
    </span>
  );
}

/* Coverage came out thin: the outline reached a slice of a large publication.
   The fix is a control the instructor already has -- the objectives box in the
   Create course modal, which skips outline generation entirely and grounds
   exactly what was typed -- so this names that box rather than offering a
   scoping feature that does not exist. One sentence, stated the way the rest of
   the screen states a limit: what happened, then what to do about it.

   Shared with the review screen, which reaches the same box by a different
   route: by then the modal is closed, so it is named rather than pointed at. */
export function ThinCoverageNotice({ inModal = false }) {
  return (
    /* A limit on what was generated, set at reading size: .p-src is the faint
       0.78em incidental style, which is not where a statement about what the
       course does not cover belongs. */
    <p style={{ marginTop: '0.6rem', fontSize: '0.9em', lineHeight: 1.5, color: 'var(--p-dim)' }}>
      This course covers part of the selected sources. To aim it at one topic, type the
      objectives you want{' '}
      {inModal ? 'in the objectives box above' : 'into the objectives box in the Create course modal'}
      , one per line, and generate again.
    </p>
  );
}

function Step({ label, state, detail }) {
  return (
    <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'baseline', padding: '0.15rem 0' }}>
      <span style={{ color: state === 'done' ? 'var(--p-good)' : 'var(--p-dim)', width: '1rem' }}>
        {state === 'done' ? '✓' : state === 'waiting' ? '·' : '…'}
      </span>
      <span style={{ fontWeight: state === 'done' ? 400 : 600 }}>{label}</span>
      {detail && <span className="p-src" style={{ marginLeft: 'auto' }}>{detail}</span>}
    </div>
  );
}

/**
 * @param {{ events: Array, interrupted?: boolean }} props
 *   `interrupted` is the one fact this screen cannot fold out of the events:
 *   the stream stopped without a `saved` or a `failed`. Only the caller holding
 *   the reader knows that, so it is passed in rather than inferred from the
 *   absence of a terminal event — which is also what a generation still in
 *   flight looks like.
 */
export function GenerationProgress({ events, interrupted = false }) {
  const view = generationView(events);
  const built = view.sections.filter((section) => section.artifacts.lesson?.ok).length;

  return (
    <div>
      <Step
        label="Reading the approved sources"
        state={view.documents ? 'done' : 'running'}
        detail={view.documents ? `${view.documents} cited passage${view.documents === 1 ? '' : 's'}` : null}
      />
      <Step
        label={view.outline === 'repairing' ? 'Rewriting the outline' : 'Writing the outline'}
        state={view.outline === 'done' ? 'done' : view.outline === 'waiting' ? 'waiting' : 'running'}
        detail={view.objectives.length ? `${view.objectives.length} objectives` : null}
      />
      {view.repairs.length > 0 && (
        <p className="p-src" style={{ margin: '0 0 0.5rem 1.6rem' }}>
          The first outline was rejected ({view.repairs.length} issue
          {view.repairs.length === 1 ? '' : 's'}); asking again with the reasons.
        </p>
      )}
      {view.title && <Step label={`Titled "${view.title}"`} state="done" />}
      {view.titleNotTaught?.length > 0 && (
        <p className="p-src" style={{ margin: '0 0 0.4rem 1.5rem', color: 'var(--p-warning)' }}>
          No section covers {view.titleNotTaught.map((word) => `"${word}"`).join(', ')}. Rename the
          course, or add what the title promises.
        </p>
      )}
      {view.total > 0 && (
        <Step
          /* Say what actually happened. A section is grounded in the union of
             the passages that cover its objective, so once any section drew on
             more than one, "its cited passage" is no longer true. */
          label={
            view.passages > view.total
              ? 'Writing each section from its cited passages'
              : 'Writing each section from its cited passage'
          }
          state={view.done ? 'done' : 'running'}
          detail={`${built}/${view.total}`}
        />
      )}

      {view.pages !== 'waiting' && (
        <Step
          label="Expanding each section into lesson pages"
          state={view.pages === 'done' ? 'done' : 'running'}
          detail={`${view.sections.filter((section) => section.artifacts.pages !== undefined).length}/${view.sections.length}`}
        />
      )}

      {view.sections.length > 0 && (
        <ol style={{ margin: '0.75rem 0 0', padding: 0, listStyle: 'none' }}>
          {view.sections.map((section) => (
            <li key={section.title} style={{ borderTop: '1px solid var(--p-border)', padding: '0.55rem 0' }}>
              <div style={{ minWidth: 0 }}>{section.title}</div>
              {section.passages > 1 && (
                <div className="p-src" style={{ marginTop: '0.2rem' }}>
                  grounded in {section.passages} cited passages
                </div>
              )}
              <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginTop: '0.35rem' }}>
                {ARTIFACTS
                  .filter((artifact) => artifact.kind !== 'diagram' || section.artifacts.diagram !== undefined)
                  .map((artifact) => (
                    <Chip
                      key={artifact.kind}
                      label={artifact.label}
                      state={section.artifacts[artifact.kind]?.ok}
                      reason={section.artifacts[artifact.kind]?.reason}
                    />
                  ))}
              </div>
              {section.artifacts.lesson?.ok === false && (
                <p className="p-src" style={{ margin: '0.35rem 0 0', color: 'var(--p-warning)' }}>
                  {section.artifacts.lesson.reason}
                </p>
              )}
              {/* Not a chip. A chip says an artifact was produced or refused,
                  and this is neither: the pages were written and the items
                  were written, and some of the items ask about something the
                  written pages do not teach. That is a note to the reviewer
                  about where to look, so it reads as a sentence. */}
              {section.artifacts.terms?.ok === false && (
                <p className="p-src" style={{ margin: '0.35rem 0 0', color: 'var(--p-warning)' }}>
                  Term drift: {section.artifacts.terms.reason}
                </p>
              )}
              {section.artifacts.title?.ok === false && (
                <p className="p-src" style={{ margin: '0.35rem 0 0', color: 'var(--p-warning)' }}>
                  {section.artifacts.title.reason}
                </p>
              )}
              {section.artifacts['item-support']?.items > 0 && (
                <p className="p-src" style={{ margin: '0.35rem 0 0', color: 'var(--p-warning)' }}>
                  {section.artifacts['item-support'].items === 1
                    ? '1 question asks about something these pages do not teach'
                    : `${section.artifacts['item-support'].items} questions ask about something these pages do not teach`}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}

      {view.skipped.length > 0 && (
        <div style={{ marginTop: '0.9rem' }}>
          {/* Not "not covered by the sources": one of the three stages feeding
              this list is a topic the sources DO cover and the course simply
              did not take. Naming the course rather than the sources is the
              only heading true of all three.

              Folded shut. Twelve topics, each ending in the same clause, is a
              wall of text that reads as twelve failures -- and it is the
              opposite: the course declining to claim coverage it does not
              have. The count is the finding and belongs in one line; the list
              is the detail and belongs behind a disclosure, open for whoever
              wants to retarget the course and out of the way for everyone
              else.

              Grouped by reason, because the three are different actions. "The
              sources do not cover this" means pick another source. "Outside
              this course's scope" means the sources have it and this run did
              not take it, which is what the objectives box is for. */}
          <details>
            <summary
              style={{
                margin: 0,
                fontSize: '0.9em',
                fontWeight: 600,
                cursor: 'pointer',
                listStyle: 'revert',
              }}
            >
              {view.skipped.length === 1
                ? '1 topic in these sources is not in this course'
                : `${view.skipped.length} topics in these sources are not in this course`}
            </summary>
            {skippedByReason(view.skipped).map((group) => (
              <div key={group.reason} style={{ marginTop: '0.5rem' }}>
                <p style={{ margin: 0, fontSize: '0.82em', color: 'var(--p-faint)' }}>{group.reason}</p>
                <ul
                  style={{
                    margin: '0.2rem 0 0',
                    paddingLeft: '1.1rem',
                    fontSize: '0.9em',
                    lineHeight: 1.5,
                    color: 'var(--p-dim)',
                  }}
                >
                  {group.objectives.map((objective) => (
                    <li key={objective}>{objective}</li>
                  ))}
                </ul>
              </div>
            ))}
          </details>
        </div>
      )}

      {view.thinCoverage && <ThinCoverageNotice inModal />}

      {Object.keys(view.apply).length > 0 && (
        <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginTop: '0.75rem' }}>
          {APPLY.map((artifact) => (
            <Chip
              key={artifact.kind}
              label={artifact.label}
              state={view.apply[artifact.kind]?.ok}
              reason={view.apply[artifact.kind]?.reason}
            />
          ))}
        </div>
      )}

      {/* The stream ended without saying how. The server is not the client's
          to speak for -- it may still be writing, or it may have saved already
          -- so this says only what is known, and names the one action that
          makes it worse. Generating again is how the same course gets written
          twice, and an instructor who is told nothing does exactly that. */}
      {interrupted && !view.saved && !view.failure && (
        <div className="s-shell-error" role="alert" style={{ marginTop: '1rem' }}>
          <p style={{ margin: 0 }}>
            The connection ended before generation reported an outcome — the reporting stopped, not
            the generation. Check the course list in a few minutes; generating again before it
            appears makes a duplicate.
          </p>
        </div>
      )}

      {view.failure && (
        <div className="s-shell-error" role="alert" style={{ marginTop: '1rem' }}>
          <p style={{ margin: 0 }}>{view.failure.error}</p>
          {Array.isArray(view.failure.validation?.issues) && view.failure.validation.issues.length > 0 && (
            <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.1rem' }}>
              {view.failure.validation.issues.map((issue) => (
                <li key={issue} style={{ fontSize: '0.9em' }}>{issue}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
