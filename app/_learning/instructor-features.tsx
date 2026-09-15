"use client";

import { useEffect, useState } from "react";
import { useApiMutation, useApiQuery } from "./use-learning";
import {
  errorMessage,
  fidelityViewModel,
  isExpectedNotFound,
  isRecord,
} from "./evidence-ui.js";
import { CourseReporting } from "./course-reporting";

type SyllabusDraft = {
  id?: string;
  title: string;
  due: string;
  hours: number | "";
};

function emptySyllabusItem(): SyllabusDraft {
  return { title: "", due: "", hours: "" };
}

function normalizeSyllabus(value: unknown): SyllabusDraft[] {
  if (!Array.isArray(value) || value.length === 0) return [emptySyllabusItem()];
  return value.map((item: any, index) => ({
    id: typeof item?.id === "string" ? item.id : `lesson-${index + 1}`,
    title: typeof item?.title === "string" ? item.title : "",
    due: typeof item?.due === "string" ? item.due : "",
    hours: typeof item?.hours === "number" && Number.isFinite(item.hours) ? item.hours : "",
  }));
}

function isRealIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function syllabusIsComplete(syllabus: SyllabusDraft[]) {
  return syllabus.length > 0 && syllabus.every((item) =>
    item.title.trim() &&
    isRealIsoDate(item.due) &&
    typeof item.hours === "number" &&
    Number.isFinite(item.hours) &&
    item.hours > 0,
  );
}

export function InstructorSyllabus({ courseId }: { courseId: string }) {
  const { data: courseData, error: courseError, loading: courseLoading, refetch } = useApiQuery<any>(
    `/courses/${courseId}`,
    { enabled: !!courseId },
  );
  const [syllabus, setSyllabus] = useState<SyllabusDraft[]>([emptySyllabusItem()]);
  const [saved, setSaved] = useState(false);
  const submitSyllabus = useApiMutation<any>(`/courses/${courseId}/syllabus`, "POST");

  useEffect(() => {
    const persisted = courseData?.course?.syllabus;
    if (Array.isArray(persisted) && persisted.length > 0) {
      setSyllabus(normalizeSyllabus(persisted));
      setSaved(true);
    }
  }, [courseData]);

  const updateItem = (index: number, patch: Partial<SyllabusDraft>) => {
    setSaved(false);
    setSyllabus((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  };

  const handleSubmit = async () => {
    if (!syllabusIsComplete(syllabus)) return;
    try {
      const result = await submitSyllabus.mutate({
        syllabus: syllabus.map((item, index) => ({
          id: item.id || `lesson-${index + 1}`,
          title: item.title.trim(),
          due: item.due,
          hours: item.hours,
        })),
      });
      setSyllabus(normalizeSyllabus(result?.syllabus || syllabus));
      setSaved(true);
      await refetch();
    } catch {
      setSaved(false);
    }
  };

  if (courseLoading) return <div className="p-panel"><p>Loading saved syllabus...</p></div>;
  if (courseError) {
    return (
      <div className="p-panel">
        <h3>Syllabus</h3>
        <p className="learning-critical"><strong>Syllabus could not be loaded.</strong></p>
        <p>{errorMessage(courseError, "The course record returned an error.")}</p>
      </div>
    );
  }

  return (
    <div className="p-panel">
      <h3>Attach Syllabus</h3>
      <p className="learning-dim">
        Save real due dates and estimated study hours. Cadence uses these persisted entries when it builds plans.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.65rem" }}>
        {syllabus.map((item, index) => (
          <div key={item.id || index} style={{ display: "grid", gridTemplateColumns: "minmax(10rem, 1fr) 9.5rem 8rem auto", gap: "0.5rem", alignItems: "center" }}>
            <label>
              <span className="learning-dim" style={{ display: "block", fontSize: "0.78em" }}>Lesson or item</span>
              <input
                className="scw-ti"
                placeholder="Lesson title"
                value={item.title}
                onChange={(event) => updateItem(index, { title: event.target.value })}
                style={{ width: "100%" }}
              />
            </label>
            <label>
              <span className="learning-dim" style={{ display: "block", fontSize: "0.78em" }}>Due date</span>
              <input
                className="scw-ti"
                type="date"
                value={item.due}
                onChange={(event) => updateItem(index, { due: event.target.value })}
                style={{ width: "100%" }}
              />
            </label>
            <label>
              <span className="learning-dim" style={{ display: "block", fontSize: "0.78em" }}>Hours estimate</span>
              <input
                className="scw-ti"
                type="number"
                min="0.25"
                step="0.25"
                placeholder="e.g. 1.5"
                value={item.hours}
                onChange={(event) => updateItem(index, { hours: event.target.value === "" ? "" : Number(event.target.value) })}
                style={{ width: "100%" }}
              />
            </label>
            <button
              type="button"
              className="p-btn ghost"
              onClick={() => {
                setSaved(false);
                setSyllabus((current) => current.length > 1 ? current.filter((_, itemIndex) => itemIndex !== index) : current);
              }}
              aria-label={`Remove syllabus item ${index + 1}`}
            >
              Remove
            </button>
          </div>
        ))}
        <button type="button" className="p-btn ghost" onClick={() => { setSaved(false); setSyllabus((current) => [...current, emptySyllabusItem()]); }} style={{ alignSelf: "flex-start" }}>
          + Add Item
        </button>
      </div>
      {!syllabusIsComplete(syllabus) && (
        <p className="learning-warning" style={{ marginTop: "0.75rem", marginBottom: 0 }}>
          Each item needs a title, a real due date, and a positive time estimate.
        </p>
      )}
      {submitSyllabus.error && (
        <p className="learning-critical" style={{ marginTop: "0.75rem", marginBottom: 0 }}>
          {errorMessage(submitSyllabus.error, "Failed to save syllabus.")}
        </p>
      )}
      {saved && !submitSyllabus.error && (
        <p className="learning-good" style={{ marginTop: "0.75rem", marginBottom: 0 }}>Syllabus saved.</p>
      )}
      <button className="p-btn" onClick={() => void handleSubmit()} disabled={submitSyllabus.loading || !syllabusIsComplete(syllabus)} style={{ marginTop: "1rem" }}>
        {submitSyllabus.loading ? "Saving..." : "Save Syllabus"}
      </button>
    </div>
  );
}

function fidelityVerdictClass(verdict: unknown) {
  if (verdict === "in-doctrine") return "learning-good";
  if (verdict === "off-doctrine") return "learning-critical";
  return "learning-warning";
}

function percentOrUnavailable(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? `${Math.round(value * 100)}%`
    : "Not available";
}

function FidelityReport({ evaluation }: { evaluation: any }) {
  const view = fidelityViewModel(evaluation);
  if (!view.report) {
    return <p className="learning-warning">No report was saved; fidelity is not available.</p>;
  }
  const report = view.report;
  return (
    <div style={{ marginTop: "1rem" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(8rem, 1fr))", gap: "0.5rem" }}>
        <div className="p-rationale"><strong>Fidelity</strong><div>{percentOrUnavailable(report.fidelity)}</div></div>
        <div className="p-rationale"><strong>Scored</strong><div>{report.scored ?? "Not available"} / {report.n ?? "Not available"}</div></div>
        <div className="p-rationale"><strong>Conforming</strong><div>{report.conforming ?? "Not available"}</div></div>
        <div className="p-rationale"><strong>Errored</strong><div>{report.errored ?? 0} (excluded)</div></div>
        <div className="p-rationale"><strong>Grounded rate</strong><div>{percentOrUnavailable(report.groundedRate)}</div></div>
      </div>

      {Object.keys(report.byVerdict).length > 0 && (
        <div style={{ marginTop: "1rem" }}>
          <h4>Verdict counts</h4>
          <ul style={{ paddingLeft: "1.5rem", marginBottom: 0 }}>
            {Object.entries(report.byVerdict).map(([verdict, count]) => <li key={verdict}>{verdict}: {String(count)}</li>)}
          </ul>
        </div>
      )}

      <div style={{ marginTop: "1rem" }}>
        <h4>Benchmark runs</h4>
        {view.runs.length === 0 ? (
          <p className="learning-dim">No benchmark runs were recorded.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {view.runs.map((run: any, index: number) => (
              <details key={`${run.id || "run"}-${index}`} className="p-rationale">
                <summary>
                  <strong className={run.errored ? "learning-warning" : fidelityVerdictClass(run.verdict)}>
                    {run.errored ? "Unavailable / excluded" : run.verdict || "Unknown"}
                  </strong>
                  {run.id ? ` · Case ${run.id}` : ` · Run ${index + 1}`}
                </summary>
                <div style={{ marginTop: "0.5rem", fontSize: "0.9em" }}>
                  {run.errored ? (
                    <p className="learning-warning">Model or network error; this run is not a doctrine result and is excluded from fidelity.</p>
                  ) : (
                    <p>Grounded: {typeof run.grounded === "boolean" ? (run.grounded ? "Yes" : "No") : "Not reported"} · Grounding score: {run.groundingScore ?? "Not reported"}</p>
                  )}
                  {run.reasons && <p><strong>Reason:</strong> {run.reasons}</p>}
                  {isRecord(run.response) && (
                    <div>
                      {typeof run.response.action === "string" && <p><strong>Action:</strong> {run.response.action}</p>}
                      {typeof run.response.rationale === "string" && <p><strong>Rationale:</strong> {run.response.rationale}</p>}
                      {typeof run.response.note === "string" && <p><strong>Note:</strong> {run.response.note}</p>}
                    </div>
                  )}
                </div>
              </details>
            ))}
          </div>
        )}
      </div>
      {report.failures.length > 0 && (
        <details style={{ marginTop: "1rem" }}>
          <summary>Inspect scored failures ({report.failures.length})</summary>
          <ul style={{ paddingLeft: "1.5rem" }}>
            {report.failures.map((failure: any, index: number) => <li key={`${failure.id || "failure"}-${index}`}>{failure.id || "Case"} · {failure.verdict || "Unknown"}{failure.reasons ? ` — ${failure.reasons}` : ""}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}

export function InstructorFidelity({ courseId }: { courseId: string }) {
  const { data: fidelityData, error, loading, refetch } = useApiQuery<any>(`/fidelity?courseId=${encodeURIComponent(courseId)}`, { enabled: !!courseId });
  const runFidelity = useApiMutation<any>("/fidelity", "POST");
  const runCases = useApiMutation<any>("/fidelity/cases", "POST");
  const [persona, setPersona] = useState("");
  const [casesList, setCasesList] = useState([{ situation: "", expect: "" }]);
  const [sourceIdsStr, setSourceIdsStr] = useState("");

  const handleRunCases = async () => {
    try {
      await runCases.mutate({
        courseId,
        sourceIds: sourceIdsStr.split(",").map((source) => source.trim()).filter(Boolean),
        persona,
        cases: casesList.filter((item) => item.situation.trim() && item.expect.trim()),
      });
      alert("Fidelity cases saved.");
    } catch {
      // Rendered below so a failed save cannot look like an empty benchmark.
    }
  };

  const handleRunFidelity = async () => {
    try {
      await runFidelity.mutate({ courseId });
      await refetch();
    } catch {
      // Render the unavailable/error response below.
    }
  };

  if (loading) return <div className="p-panel"><p>Loading fidelity report...</p></div>;
  const expectedEmpty = isExpectedNotFound(error, "FIDELITY_NOT_FOUND");

  return (
    <div className="p-panel">
      <h3>Doctrinal Fidelity (Understudy)</h3>
      {error && !expectedEmpty ? (
        <div>
          <p className="learning-critical"><strong>Fidelity report could not be loaded.</strong></p>
          <p>{errorMessage(error, "The fidelity service returned an error.")}</p>
        </div>
      ) : fidelityData && !fidelityData.error ? (
        <div>
          <p><strong>Status:</strong> {fidelityData.status || "Saved"}</p>
          <FidelityReport evaluation={fidelityData} />
          <button className="p-btn ghost" onClick={() => void handleRunFidelity()} disabled={runFidelity.loading} style={{ marginTop: "1rem" }}>
            {runFidelity.loading ? "Running..." : "Re-run Fidelity Check"}
          </button>
        </div>
      ) : (
        <div>
          <p className="learning-dim">No saved fidelity report yet. Save approved doctrine cases, then run the benchmark.</p>
          <FidelityCaseForm
            sourceIdsStr={sourceIdsStr}
            setSourceIdsStr={setSourceIdsStr}
            persona={persona}
            setPersona={setPersona}
            casesList={casesList}
            setCasesList={setCasesList}
            onSubmit={() => void handleRunCases()}
            loading={runCases.loading}
            error={runCases.error}
          />
          <button className="p-btn" onClick={() => void handleRunFidelity()} disabled={runFidelity.loading} style={{ marginTop: "0.75rem" }}>
            {runFidelity.loading ? "Running..." : "Run Fidelity Check"}
          </button>
        </div>
      )}
      {runFidelity.error && (
        <p className={Number(runFidelity.error.status) === 503 || runFidelity.error.status === "unavailable" ? "learning-warning" : "learning-critical"} style={{ marginTop: "1rem" }}>
          <strong>{Number(runFidelity.error.status) === 503 || runFidelity.error.status === "unavailable" ? "Fidelity benchmark unavailable." : "Fidelity run failed."}</strong>{" "}
          {errorMessage(runFidelity.error, "No result was saved.")}
        </p>
      )}
    </div>
  );
}

function FidelityCaseForm({
  sourceIdsStr,
  setSourceIdsStr,
  persona,
  setPersona,
  casesList,
  setCasesList,
  onSubmit,
  loading,
  error,
}: {
  sourceIdsStr: string;
  setSourceIdsStr: (value: string) => void;
  persona: string;
  setPersona: (value: string) => void;
  casesList: { situation: string; expect: string }[];
  setCasesList: (value: { situation: string; expect: string }[]) => void;
  onSubmit: () => void;
  loading: boolean;
  error: any;
}) {
  return (
    <div style={{ marginBottom: "1rem" }}>
      <h4>Configure Fidelity Cases</h4>
      <input className="scw-ti" placeholder="Approved source IDs (comma-separated)" value={sourceIdsStr} onChange={(event) => setSourceIdsStr(event.target.value)} style={{ width: "100%", marginBottom: "0.5rem" }} />
      <input className="scw-ti" placeholder="Persona" value={persona} onChange={(event) => setPersona(event.target.value)} style={{ width: "100%", marginBottom: "0.5rem" }} />
      {casesList.map((item, index) => (
        <div key={index} style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem" }}>
          <input className="scw-ti" placeholder="Situation" value={item.situation} onChange={(event) => setCasesList(casesList.map((entry, itemIndex) => itemIndex === index ? { ...entry, situation: event.target.value } : entry))} style={{ flex: 1 }} />
          <input className="scw-ti" placeholder="Expected behavior" value={item.expect} onChange={(event) => setCasesList(casesList.map((entry, itemIndex) => itemIndex === index ? { ...entry, expect: event.target.value } : entry))} style={{ flex: 1 }} />
        </div>
      ))}
      <button type="button" className="p-btn ghost" onClick={() => setCasesList([...casesList, { situation: "", expect: "" }])} style={{ marginBottom: "0.5rem", display: "block" }}>+ Add Case</button>
      {error && <p className="learning-critical">{errorMessage(error, "Failed to save fidelity cases.")}</p>}
      <button className="p-btn ghost" onClick={onSubmit} disabled={loading}>
        {loading ? "Saving..." : "Save Cases"}
      </button>
    </div>
  );
}

function AARReport({ report }: { report: any }) {
  const sustains = Array.isArray(report?.sustains) ? report.sustains : [];
  const improves = Array.isArray(report?.improves) ? report.improves : [];
  const byArea = Array.isArray(report?.byArea) ? report.byArea : [];
  const meta = isRecord(report?.meta) ? report.meta : {};

  return (
    <div style={{ marginTop: "1rem" }}>
      <div className="p-rationale">
        <strong>Hotwash summary</strong>
        <div style={{ fontSize: "0.9em", marginTop: "0.35rem" }}>
          {meta.critiques ?? "Unknown"} critiques · {meta.areas ?? "Unknown"} areas · {meta.iterations ?? "Unknown"} input iterations · {meta.shortTerm ?? 0} short-term / {meta.longTerm ?? 0} long-term improvements
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(14rem, 1fr))", gap: "0.75rem", marginTop: "0.75rem" }}>
        <div className="p-rationale">
          <strong>Sustain</strong>
          {sustains.length === 0 ? <p className="learning-dim" style={{ marginTop: "0.5rem", marginBottom: 0 }}>No sustain findings.</p> : (
            <ul style={{ paddingLeft: "1.25rem", marginBottom: 0 }}>
              {sustains.map((item: any, index: number) => <li key={`${item.area || "area"}-${index}`}>{item.area || "Unlabelled area"} · {item.mentions ?? "?"} mention(s)</li>)}
            </ul>
          )}
        </div>
        <div className="p-rationale">
          <strong>Improve</strong>
          {improves.length === 0 ? <p className="learning-dim" style={{ marginTop: "0.5rem", marginBottom: 0 }}>No improve findings.</p> : (
            <ul style={{ paddingLeft: "1.25rem", marginBottom: 0 }}>
              {improves.map((item: any, index: number) => <li key={`${item.area || "area"}-${index}`}><strong>{item.area || "Unlabelled area"}</strong> · {item.horizon || "horizon not reported"} · {item.trend || "trend not reported"} · priority {item.priority ?? "not reported"}</li>)}
            </ul>
          )}
        </div>
      </div>
      {byArea.length > 0 && (
        <details style={{ marginTop: "0.75rem" }}>
          <summary>Inspect area rollup ({byArea.length})</summary>
          <ul style={{ paddingLeft: "1.5rem" }}>
            {byArea.map((item: any, index: number) => <li key={`${item.area || "area"}-${index}`}>{item.area || "Unlabelled area"} · {item.sustain ?? 0} sustain · {item.improve ?? 0} improve · mean severity {item.meanSeverity ?? "not reported"}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}

function InstructorAARPanel({ courseId }: { courseId: string }) {
  const { data: aarData, error, loading, refetch } = useApiQuery<any>(`/aar?courseId=${encodeURIComponent(courseId)}`, { enabled: !!courseId });
  const generateAar = useApiMutation<any>("/aar", "POST");
  const submitCritiques = useApiMutation<any>("/aar/critiques", "POST");
  const [critiqueArea, setCritiqueArea] = useState("");
  const [critiqueKind, setCritiqueKind] = useState("sustain");
  const [critiqueText, setCritiqueText] = useState("");
  const [critiqueIteration, setCritiqueIteration] = useState("");
  const [critiqueSeverity, setCritiqueSeverity] = useState("3");
  const [critiqueSaved, setCritiqueSaved] = useState(false);

  const handleCritiques = async () => {
    if (!critiqueArea.trim() || !critiqueText.trim()) return;
    try {
      await submitCritiques.mutate({
        courseId,
        critiques: [{
          area: critiqueArea.trim(),
          kind: critiqueKind,
          note: critiqueText.trim(),
          text: critiqueText.trim(),
          iteration: critiqueIteration.trim() || undefined,
          severity: Number(critiqueSeverity),
        }],
      });
      setCritiqueSaved(true);
      setCritiqueText("");
      await refetch();
    } catch {
      setCritiqueSaved(false);
    }
  };

  const handleGenerate = async () => {
    try {
      await generateAar.mutate({ courseId });
      await refetch();
    } catch {
      // Explicit mutation error is shown below.
    }
  };

  if (loading) return <div className="p-panel"><p>Loading AAR...</p></div>;
  const expectedEmpty = isExpectedNotFound(error, "AAR_NOT_FOUND");
  const loadFailed = Boolean(error && !expectedEmpty);
  const report = isRecord(aarData?.report) ? aarData.report : null;
  const input = isRecord(aarData?.input) ? aarData.input : {};
  const provenance = isRecord(aarData?.provenance)
    ? aarData.provenance
    : isRecord(input.provenance)
      ? input.provenance
      : {};
  const inputIterations = Array.isArray(aarData?.inputIterations)
    ? aarData.inputIterations
    : Array.isArray(input.iterations)
      ? input.iterations
      : Array.isArray(input.critiques)
        ? [...new Set(input.critiques
          .map((critique: any) => critique?.iteration)
          .filter((iteration: unknown) => iteration != null && String(iteration).trim())
          .map(String))]
        : [];
  const hasSavedAar = Boolean(aarData && !aarData.error);

  return (
    <div className="p-panel">
      <h3>After-Action Review (Hotwash)</h3>
      {loadFailed && (
        <p className="learning-critical"><strong>AAR could not be loaded.</strong> {errorMessage(error, "The AAR service returned an error.")}</p>
      )}
      <div style={{ marginBottom: "1rem" }}>
        <h4>Save critique input</h4>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(8rem, 1fr) 8rem 8rem", gap: "0.5rem", marginBottom: "0.5rem" }}>
          <input className="scw-ti" placeholder="Area" value={critiqueArea} onChange={(event) => setCritiqueArea(event.target.value)} />
          <select className="scw-ti" value={critiqueKind} onChange={(event) => setCritiqueKind(event.target.value)}>
            <option value="sustain">Sustain</option><option value="improve">Improve</option>
          </select>
          <input className="scw-ti" type="number" min="1" max="5" step="1" value={critiqueSeverity} onChange={(event) => setCritiqueSeverity(event.target.value)} aria-label="Critique severity" />
        </div>
        <input className="scw-ti" placeholder="Class iteration (e.g. 2026-Q1)" value={critiqueIteration} onChange={(event) => setCritiqueIteration(event.target.value)} style={{ width: "100%", marginBottom: "0.5rem" }} />
        <textarea className="scw-ti" placeholder="Critique text" value={critiqueText} onChange={(event) => setCritiqueText(event.target.value)} rows={2} style={{ width: "100%", marginBottom: "0.5rem" }} />
        {submitCritiques.error && <p className="learning-critical">{errorMessage(submitCritiques.error, "Failed to save critique input.")}</p>}
        {critiqueSaved && !submitCritiques.error && <p className="learning-good">Critique input saved.</p>}
        <button className="p-btn ghost" onClick={() => void handleCritiques()} disabled={submitCritiques.loading || !critiqueArea.trim() || !critiqueText.trim()}>
          {submitCritiques.loading ? "Saving..." : "Save Critique"}
        </button>
      </div>

      {hasSavedAar && !report ? (
        <p className="learning-critical"><strong>Saved AAR is incomplete.</strong> The saved record did not include a Hotwash report, so no findings were inferred.</p>
      ) : hasSavedAar && report ? (
        <div>
          <div className="p-rationale">
            <span className="p-rlab">Saved provenance</span>
            <p><strong>Source:</strong> {aarData.source === "heuristic" ? "Heuristic (no model available)" : aarData.source === "model" ? "Injected model narrative" : aarData.source || "Not reported"}</p>
            <p><strong>Model available:</strong> {typeof aarData.modelAvailable === "boolean" ? (aarData.modelAvailable ? "Yes" : "No") : "Not reported"}</p>
            <p><strong>Saved:</strong> {aarData.persisted === true ? "Yes" : "Saved record loaded"}</p>
            <p><strong>Input iterations:</strong> {inputIterations.length > 0 ? inputIterations.map(String).join(", ") : isRecord(report.meta) && report.meta.iterations != null ? `${report.meta.iterations} iteration(s) represented; labels were not returned by the saved contract.` : "Not reported"}</p>
            {Object.keys(provenance).length > 0 && <pre className="learning-json" style={{ marginBottom: 0 }}>{JSON.stringify(provenance, null, 2)}</pre>}
            {Array.isArray(input.critiques) && (
              <details style={{ marginTop: "0.75rem" }}>
                <summary>Inspect saved critique input ({input.critiques.length})</summary>
                <ul style={{ paddingLeft: "1.5rem", marginBottom: 0 }}>
                  {input.critiques.map((critique: any, index: number) => (
                    <li key={`${critique.area || "critique"}-${index}`}>
                      {critique.area || "Unlabelled area"} · {critique.kind || "improve"} · iteration {critique.iteration || "not labelled"}{critique.note || critique.text ? ` · ${critique.note || critique.text}` : ""}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
          <AARReport report={report} />
          <div className="p-rationale" style={{ margin: "1rem 0" }}>
            <span className="p-rlab">Memo</span>
            <pre style={{ whiteSpace: "pre-wrap", margin: 0, font: "inherit", fontSize: "0.9em" }}>{aarData.memo || "No memo was returned."}</pre>
          </div>
          <button className="p-btn ghost" onClick={() => void handleGenerate()} disabled={generateAar.loading}>
            {generateAar.loading ? "Generating..." : "Regenerate AAR"}
          </button>
        </div>
      ) : loadFailed ? (
        <p className="learning-dim">The saved AAR is unavailable until the load error is resolved. Critique input can still be saved for a later retry.</p>
      ) : (
        <div>
          <p className="learning-dim">No saved AAR yet. Save critique input across one or more class iterations, then generate the deterministic Hotwash report.</p>
          {generateAar.error && <p className="learning-critical">{errorMessage(generateAar.error, "Failed to generate AAR.")}</p>}
          <button className="p-btn" onClick={() => void handleGenerate()} disabled={generateAar.loading}>
            {generateAar.loading ? "Generating..." : "Generate AAR"}
          </button>
        </div>
      )}
    </div>
  );
}

export function InstructorAAR({ courseId }: { courseId: string }) {
  return (
    <CourseReporting
      courseId={courseId}
      renderApprovedSyllabus={() => <InstructorSyllabus courseId={courseId} />}
    >
      <InstructorAARPanel courseId={courseId} />
    </CourseReporting>
  );
}

export function RubricsView() {
  const [sourceId, setSourceId] = useState("");
  const [taskCode, setTaskCode] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskCondition, setTaskCondition] = useState("");
  const [taskStandard, setTaskStandard] = useState("");
  const [taskSteps, setTaskSteps] = useState("");
  const [generatedRubricId, setGeneratedRubricId] = useState<string | null>(null);
  const generateRubric = useApiMutation<any>("/rubrics/generate", "POST");
  const approveRubric = useApiMutation<any>(`/rubrics/${generatedRubricId}/approve`, "POST");
  const { data: rubricData } = useApiQuery<any>(`/rubrics/${generatedRubricId}`, { enabled: !!generatedRubricId });

  const handleGenerate = async () => {
    if (!sourceId || !taskCode) return;
    try {
      const result = await generateRubric.mutate({
        sourceId,
        task: {
          code: taskCode,
          title: taskTitle,
          condition: taskCondition,
          standard: taskStandard,
          performanceSteps: taskSteps.split("\n").filter(Boolean),
        },
      });
      setGeneratedRubricId(result.id);
    } catch (error: any) {
      alert(error.error || "Failed to generate rubric");
    }
  };
  const handleApprove = async () => {
    try {
      await approveRubric.mutate();
      alert("Rubric approved!");
    } catch (error: any) {
      alert(error.error || "Failed to approve rubric");
    }
  };

  return (
    <div>
      <h2 className="p-h">Rubric Generation (Rubricon)</h2>
      <div className="p-panel">
        <h3>Generate New Rubric</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <input className="scw-ti" placeholder="Source ID" value={sourceId} onChange={(event) => setSourceId(event.target.value)} />
          <input className="scw-ti" placeholder="Task Code (e.g. TASK-01)" value={taskCode} onChange={(event) => setTaskCode(event.target.value)} />
          <input className="scw-ti" placeholder="Task Title" value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} />
          <input className="scw-ti" placeholder="Task Condition" value={taskCondition} onChange={(event) => setTaskCondition(event.target.value)} />
          <input className="scw-ti" placeholder="Task Standard" value={taskStandard} onChange={(event) => setTaskStandard(event.target.value)} />
          <textarea className="scw-ti" placeholder="Performance Steps (one per line)" value={taskSteps} onChange={(event) => setTaskSteps(event.target.value)} rows={4} />
          <button className="p-btn" onClick={() => void handleGenerate()} disabled={generateRubric.loading}>
            {generateRubric.loading ? "Generating..." : "Generate Rubric"}
          </button>
        </div>
      </div>
      {generatedRubricId && (
        <div className="p-panel" style={{ marginTop: "1rem" }}>
          <h3>Review Rubric</h3>
          {rubricData ? (
            <div>
              <p><strong>Status:</strong> {rubricData.status}</p>
              {rubricData.validation && <p><strong>Validation:</strong> {rubricData.validation.valid ? "Valid" : "Invalid"}</p>}
              {rubricData.traceability && (
                <div>
                  <p><strong>Traceability:</strong> {rubricData.traceability.grounded ? "Grounded" : "Ungrounded"}</p>
                  {rubricData.traceability.ungrounded?.length > 0 && <p className="learning-critical" style={{ fontSize: "0.85em" }}><strong>Ungrounded elements:</strong> {rubricData.traceability.ungrounded.join(", ")}</p>}
                </div>
              )}
              {rubricData.rubric?.flagged && <p className="learning-critical"><strong>Flagged:</strong> {rubricData.rubric.flagReason || "Yes"}</p>}
              <pre className="learning-json">{JSON.stringify(rubricData.rubric || rubricData, null, 2)}</pre>
              {rubricData.status === "PENDING" && (
                <button className="p-btn" onClick={() => void handleApprove()} disabled={approveRubric.loading} style={{ marginTop: "1rem" }}>
                  {approveRubric.loading ? "Approving..." : "Approve Rubric"}
                </button>
              )}
            </div>
          ) : <p>Loading rubric...</p>}
        </div>
      )}
    </div>
  );
}