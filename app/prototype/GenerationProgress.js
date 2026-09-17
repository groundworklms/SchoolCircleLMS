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
    apply: {},
    done: false,
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
  for (const event of Array.isArray(events) ? events : []) {
    if (event.phase === 'sources') {
      view.documents = event.documents || 0;
      view.characters = event.characters || 0;
    } else if (event.phase === 'outline') {
      if (event.status === 'start') view.outline = 'running';
      if (event.status === 'repair') {
        view.outline = 'repairing';
        view.repairs = event.issues || [];
      }
      if (event.status === 'done') {
        view.outline = 'done';
        view.objectives = event.objectives || [];
      }
    } else if (event.phase === 'title') {
      view.title = event.title || '';
    } else if (event.phase === 'sections') {
      view.total = event.total || 0;
      view.passages = event.passages || 0;
    } else if (event.phase === 'coursewright') {
      if (event.step === 'skipped') {
        view.skipped.push(event.section);
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
    } else if (event.phase === 'saved') {
      view.saved = event.record || null;
    } else if (event.phase === 'failed') {
      view.failure = event;
    }
  }
  return view;
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

export function GenerationProgress({ events }) {
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
            </li>
          ))}
        </ol>
      )}

      {view.skipped.length > 0 && (
        <p className="p-src" style={{ marginTop: '0.75rem' }}>
          Not covered by the selected sources, so not written: {view.skipped.join('; ')}
        </p>
      )}

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
