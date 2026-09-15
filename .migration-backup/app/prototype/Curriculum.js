'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { POIS } from './poi';

/* Instructor-facing curriculum ingest.
   The POI upload and parse are REAL — the file is posted to /api/ingest and
   parsed server-side. Generation is real too, when a model is configured;
   without one the screen says so rather than faking output. */

const SCOPE_LABEL = { course: 'Course', annex: 'Annex', lesson: 'Lesson' };

const SEED_DOCS_BY_COURSE = {
  M092721: [
    { id: 1, name: 'Course_Welcome_Aboard.pdf', scope: 'course', ref: null, size: '1.2 MB' },
    { id: 2, name: 'Grob_Basic_Electronics_ch1-4.pdf', scope: 'annex', ref: 'A', size: '18.4 MB' },
    { id: 3, name: 'Fluke_77_Operator_Manual.pdf', scope: 'lesson', ref: 'BE.01.03', size: '2.8 MB' },
  ],
  M09CVS1: [
    { id: 1, name: 'Course_Welcome_Aboard.pdf', scope: 'course', ref: null, size: '1.2 MB' },
    { id: 2, name: 'OSI_Model_Reference.pdf', scope: 'annex', ref: 'A', size: '6.1 MB' },
    { id: 3, name: 'Router_Config_Cheatsheet.pdf', scope: 'lesson', ref: 'TI.02.01', size: '0.9 MB' },
  ],
};

export default function Curriculum({ course }) {
  const fallback = POIS[course.id];

  const [poi, setPoi] = useState(null); // set only by a real upload
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [hot, setHot] = useState(false);
  const [open, setOpen] = useState({ A: true });
  const [sel, setSel] = useState({ scope: 'course', ref: null });
  const [docs, setDocs] = useState(SEED_DOCS_BY_COURSE[course.id] || []);
  const [provider, setProvider] = useState(null);
  const [gen, setGen] = useState(null);
  const [caps, setCaps] = useState(null);
  const [genBusy, setGenBusy] = useState(false);
  const [genErr, setGenErr] = useState(null);
  const nextId = useRef(100);
  const fileInput = useRef(null);
  const docInput = useRef(null);

  const active = poi || fallback;
  const isLive = Boolean(poi);

  useEffect(() => {
    fetch('/api/generate')
      .then((r) => r.json())
      .then(setProvider)
      .catch(() => setProvider({ ready: false, reason: 'status unavailable' }));
    fetch('/api/capabilities')
      .then((r) => r.json())
      .then((d) => setCaps(d.capabilities))
      .catch(() => setCaps(null));
  }, []);

  /* ---------- real POI upload ---------- */
  const ingest = async (file) => {
    if (!file) return;
    setBusy(true);
    setErr(null);
    setGen(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/ingest', { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setPoi(json);
      setSel({ scope: 'course', ref: null });
      setOpen({ [json.annexes?.[0]?.letter]: true });
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setBusy(false);
    }
  };

  /* ---------- real generation ---------- */
  const generate = async () => {
    if (sel.scope !== 'lesson') return;
    const annex = active.annexes.find((a) => a.lessons.some((l) => l.id === sel.ref));
    const lesson = annex?.lessons.find((l) => l.id === sel.ref);
    setGenBusy(true);
    setGenErr(null);
    setGen(null);
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ course: active, annex, lesson }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setGen(json);
    } catch (e) {
      setGenErr(String(e.message || e));
    } finally {
      setGenBusy(false);
    }
  };

  const addDocs = (files) =>
    setDocs((d) => [
      ...d,
      ...files.map((f) => ({
        id: nextId.current++,
        name: f.name,
        size: `${Math.max(1, Math.round(f.size / 1024))} KB`,
        scope: sel.scope,
        ref: sel.ref,
      })),
    ]);

  const selLabel =
    sel.scope === 'course'
      ? `Course — ${active.courseTitle}`
      : sel.scope === 'annex'
        ? `Annex ${sel.ref} — ${active.annexes.find((a) => a.letter === sel.ref)?.title}`
        : `Lesson ${sel.ref}`;

  const inherited = useMemo(() => {
    if (sel.scope !== 'lesson') return null;
    const annex = active.annexes.find((a) => a.lessons.some((l) => l.id === sel.ref))?.letter;
    return docs.filter(
      (d) =>
        (d.scope === 'lesson' && d.ref === sel.ref) ||
        (d.scope === 'annex' && d.ref === annex) ||
        d.scope === 'course'
    );
  }, [docs, sel, active]);

  const countFor = (scope, ref) => docs.filter((d) => d.scope === scope && d.ref === ref).length;
  const rec = active.reconciliation;

  return (
    <>
      <h2 className="p-h">Curriculum</h2>
      <p className="p-sub">
        Post the Program of Instruction once per course. Structure is extracted from the document
        itself; everything generated downstream is derived from it, after the instructor verifies it.
      </p>

      {/* ---------- upload ---------- */}
      <div className="p-panel">
        <h3>
          Post a Program of Instruction
          <span style={{ float: 'right' }}>
            <span className={`p-live${isLive ? ' on' : ''}`}>
              {isLive ? 'PARSED FROM YOUR FILE' : 'SHOWING SAVED SAMPLE'}
            </span>
          </span>
        </h3>

        <div
          className={`p-drop${hot ? ' hot' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setHot(true);
          }}
          onDragLeave={() => setHot(false)}
          onDrop={(e) => {
            e.preventDefault();
            setHot(false);
            ingest(e.dataTransfer.files?.[0]);
          }}
          onClick={() => fileInput.current?.click()}
          style={{ cursor: 'pointer' }}
        >
          <span className="p-dropicon">📕</span>
          {busy ? 'Parsing…' : 'Drop a POI Combined Report here, or click to choose'}
          <div style={{ fontSize: '0.82em', color: 'var(--p-faint)', marginTop: '0.3rem' }}>
            Parsed server-side. Nothing is uploaded anywhere else.
          </div>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="application/pdf"
          hidden
          onChange={(e) => ingest(e.target.files?.[0])}
        />

        {err && <div className="p-err">Parse failed: {err}</div>}

        {isLive && (
          <div className="p-filerow">
            <span>📕</span>
            <span className="p-fname">{poi.sourceDoc}</span>
            <span className="p-fmeta">
              {poi.sourcePages} pages · parsed in {poi.parseMs} ms
            </span>
            <button className="p-btn ghost" onClick={() => { setPoi(null); setGen(null); }}>
              Clear
            </button>
          </div>
        )}
      </div>

      <div className="p-tiles">
        <div className="p-tile">
          <div className="p-tilelab">Course</div>
          <div className="p-tileval" style={{ fontSize: '1.05em' }}>{active.courseId}</div>
          <div className="p-tilenote">v{active.version}</div>
        </div>
        <div className="p-tile">
          <div className="p-tilelab">Annexes</div>
          <div className="p-tileval">{active.annexes.length}</div>
        </div>
        <div className="p-tile">
          <div className="p-tilelab">Concept cards</div>
          <div className="p-tileval">{active.totalLessons}</div>
          <div className="p-tilenote">lessons + exams</div>
        </div>
        <div className="p-tile">
          <div className="p-tilelab">Hours</div>
          <div className="p-tileval">{active.totalHours}</div>
        </div>
        <div className="p-tile">
          <div className="p-tilelab">Objectives</div>
          <div className="p-tileval">{active.totalObjectives}</div>
          <div className="p-tilenote">T&amp;R linked</div>
        </div>
      </div>

      {rec && (
        <div className={`p-check${rec.ok ? ' ok' : ' bad'}`}>
          <strong>{rec.ok ? '✓ Hours reconcile' : '⚠ Hours mismatch'}</strong>
          <span>
            Parsed academic hours {rec.academicParsed} vs {rec.academicStated ?? '—'} declared in the
            POI&apos;s own summary.{' '}
            {rec.ok
              ? 'Every concept card was accounted for.'
              : 'Something did not parse — verify before generating.'}
          </span>
        </div>
      )}

      {caps && (
        <div className="p-panel">
          <h3>Model capabilities</h3>
          <div className="p-tablewrap">
            <table className="p-table">
              <thead>
                <tr>
                  <th>Capability</th>
                  <th>Status</th>
                  <th>Used for</th>
                  <th>If the event compute is air-gapped</th>
                </tr>
              </thead>
              <tbody>
                {caps.map((c) => (
                  <tr key={c.id}>
                    <td>
                      {c.label}
                      {c.critical && <span className="p-tag" style={{ marginLeft: '0.4rem' }}>required</span>}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <span
                        style={{
                          color: c.ready
                            ? c.degraded
                              ? 'var(--p-warning)'
                              : 'var(--p-good)'
                            : 'var(--p-critical)',
                        }}
                      >
                        ●
                      </span>{' '}
                      {c.ready ? (c.degraded ? `fallback — ${c.via}` : c.via) : 'not configured'}
                    </td>
                    <td>{c.used}</td>
                    <td>{c.onPrem}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="p-src">
            Each capability resolves its own backend and fails on its own. Speech falls back to the
            browser&apos;s own synthesis — no key, no network, works air-gapped — so it is never a
            hard blocker. Only text is required for the platform to function.
          </p>
        </div>
      )}

      <div className="p-grid2">
        {/* ---------- structure tree ---------- */}
        <div className="p-panel">
          <h3>Verify the parsed structure</h3>

          <button
            className={`p-node p-node-course${sel.scope === 'course' ? ' on' : ''}`}
            onClick={() => setSel({ scope: 'course', ref: null })}
          >
            <span className="p-nodetitle">{active.courseTitle}</span>
            <span className="p-nodemeta">
              {countFor('course', null) > 0 && <span className="p-attach">{countFor('course', null)} doc</span>}
              course
            </span>
          </button>

          {active.annexes.map((a) => (
            <div key={a.letter}>
              <div className="p-noderow">
                <button
                  className="p-twisty"
                  onClick={() => setOpen((o) => ({ ...o, [a.letter]: !o[a.letter] }))}
                  aria-label={open[a.letter] ? 'Collapse' : 'Expand'}
                >
                  {open[a.letter] ? '▾' : '▸'}
                </button>
                <button
                  className={`p-node p-node-annex${sel.scope === 'annex' && sel.ref === a.letter ? ' on' : ''}`}
                  onClick={() => setSel({ scope: 'annex', ref: a.letter })}
                >
                  <span className="p-nodetitle">
                    Annex {a.letter} — {a.title}
                  </span>
                  <span className="p-nodemeta">
                    {countFor('annex', a.letter) > 0 && (
                      <span className="p-attach">{countFor('annex', a.letter)} doc</span>
                    )}
                    {a.lessons.length} cards · {a.hours} h
                  </span>
                </button>
              </div>

              {open[a.letter] &&
                a.lessons.map((l) => (
                  <button
                    key={l.id}
                    className={`p-node p-node-lesson${sel.scope === 'lesson' && sel.ref === l.id ? ' on' : ''}`}
                    onClick={() => setSel({ scope: 'lesson', ref: l.id })}
                  >
                    <span className="p-nodeid">{l.id}</span>
                    <span className="p-nodetitle">{l.title}</span>
                    <span className="p-nodemeta">
                      {countFor('lesson', l.id) > 0 && <span className="p-attach">{countFor('lesson', l.id)}</span>}
                      {l.kind === 'exam' && <span className="p-examtag">EXAM</span>}
                      {l.hours} h
                    </span>
                  </button>
                ))}
            </div>
          ))}
        </div>

        <div>
          {/* ---------- generation ---------- */}
          <div className="p-panel">
            <h3>
              Generate materials
              {provider && (
                <span style={{ float: 'right' }}>
                  <span className={`p-live${provider.ready ? ' on' : ''}`}>
                    {provider.ready ? `${provider.provider} · ${provider.model}` : 'NO MODEL CONFIGURED'}
                  </span>
                </span>
              )}
            </h3>

            {sel.scope !== 'lesson' ? (
              <p style={{ color: 'var(--p-faint)', fontSize: '0.88em', margin: 0 }}>
                Select a lesson in the tree to generate study aids for it.
              </p>
            ) : (
              <>
                <p style={{ fontSize: '0.88em', margin: '0 0 0.7rem', color: 'var(--p-dim)' }}>
                  Lesson <b style={{ color: 'var(--p-text)' }}>{sel.ref}</b> — the POI structure is sent
                  as cacheable context, so repeat generations against this course are cheap.
                </p>
                <div className="p-btnrow">
                  <button className="p-btn" onClick={generate} disabled={genBusy || !provider?.ready}>
                    {genBusy ? 'Generating…' : 'Generate study aids'}
                  </button>
                  {!provider?.ready && (
                    <span style={{ fontSize: '0.82em', color: 'var(--p-warning)' }}>
                      Needs a model — see below
                    </span>
                  )}
                </div>
              </>
            )}

            {genErr && <div className="p-err">{genErr}</div>}

            {!provider?.ready && provider && (
              <div className="p-note">
                <b>To connect a model</b>
                <div>
                  Set <code>MODEL_BASE_URL</code> and <code>MODEL_ID</code> in{' '}
                  <code>.env.local</code> and restart. Any OpenAI-compatible endpoint works,
                  including a self-hosted, air-gapped one (the on-device gen model).
                </div>
              </div>
            )}

            {gen && (
              <div className="p-out" style={{ marginTop: '0.9rem' }}>
                <div className="p-genmeta">
                  {gen.model} · {gen.ms} ms
                  {gen.usage?.input != null && <> · {gen.usage.input} in / {gen.usage.output} out</>}
                  {gen.usage?.cacheRead ? <> · {gen.usage.cacheRead} cached</> : null}
                  <span className="p-tag">DRAFT — awaiting instructor review</span>
                </div>
                <h4>Summary</h4>
                <p style={{ color: 'var(--p-dim)' }}>{gen.data.summary}</p>
                <h4>Key terms</h4>
                {gen.data.keyTerms?.map((t) => (
                  <div className="p-keyterm" key={t.term}>
                    <b>{t.term}</b>
                    <span>{t.definition}</span>
                  </div>
                ))}
                <h4>Practice questions</h4>
                {gen.data.questions?.map((q, i) => (
                  <div key={i} style={{ marginBottom: '0.8rem' }}>
                    <p style={{ margin: '0 0 0.3rem' }}>
                      {i + 1}. {q.q}
                    </p>
                    <ul style={{ margin: '0 0 0.3rem' }}>
                      {q.answers.map((a) => (
                        <li key={a.text} style={{ color: a.correct ? 'var(--p-good)' : 'var(--p-dim)' }}>
                          {a.text}
                          {a.correct && ' ✓'}
                        </li>
                      ))}
                    </ul>
                    <p style={{ fontSize: '0.9em', color: 'var(--p-faint)', margin: 0 }}>{q.rationale}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ---------- attachments ---------- */}
          <div className="p-panel">
            <h3>Supporting documents</h3>
            <div className="p-selbar">
              <span className="p-sellab">Attaching to</span>
              <span className="p-selval">{selLabel}</span>
              <span className="p-tag">{SCOPE_LABEL[sel.scope]}</span>
            </div>

            <div
              className="p-drop"
              style={{ padding: '1rem', marginTop: '0.6rem', cursor: 'pointer' }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                addDocs(Array.from(e.dataTransfer.files || []));
              }}
              onClick={() => docInput.current?.click()}
            >
              <span className="p-dropicon" style={{ fontSize: '1.3em' }}>📎</span>
              Attach files at this level
            </div>
            <input
              ref={docInput}
              type="file"
              multiple
              hidden
              onChange={(e) => addDocs(Array.from(e.target.files || []))}
            />

            <ul className="p-files" style={{ marginTop: '0.7rem' }}>
              {docs.map((d) => (
                <li className="p-file" key={d.id}>
                  <span>📎</span>
                  <span className="p-fname">{d.name}</span>
                  <span className="p-tag">
                    {d.scope === 'course' ? 'Course' : d.scope === 'annex' ? `Annex ${d.ref}` : d.ref}
                  </span>
                  <span className="p-fmeta">{d.size}</span>
                  <button className="p-x" onClick={() => setDocs((x) => x.filter((y) => y.id !== d.id))}>
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {inherited && (
            <div className="p-panel">
              <h3>What a student sees at {sel.ref}</h3>
              <ul className="p-req">
                {inherited.map((d) => (
                  <li className="p-reqrow" key={d.id}>
                    <span style={{ fontSize: '0.8em' }}>📎</span>
                    <span className="p-reqname">{d.name}</span>
                    <span className="p-tag">
                      {d.scope === 'course'
                        ? 'from course'
                        : d.scope === 'annex'
                          ? `from annex ${d.ref}`
                          : 'this lesson'}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="p-src">
                Attachments inherit downward — attach once at the annex and every lesson under it
                carries it.
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
