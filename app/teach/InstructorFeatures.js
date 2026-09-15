'use client';

import { useState } from 'react';
import { useApiQuery, useApiMutation } from '../_learning/useLearning';

export function InstructorSyllabus({ courseId }) {
  const [syllabus, setSyllabus] = useState([{ title: "", due: "" }]);
  const submitSyllabus = useApiMutation(`/courses/${courseId}/syllabus`, "POST");

  const handleSubmit = async () => {
    try {
      await submitSyllabus.mutate({ syllabus });
      alert("Syllabus attached");
    } catch (e) {
      alert(e.error || "Failed to attach syllabus");
    }
  };

  return (
    <div className="p-panel">
      <h3>Attach Syllabus</h3>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        {syllabus.map((item, i) => (
          <div key={i} style={{ display: "flex", gap: "0.5rem" }}>
            <input 
              className="scw-ti" 
              placeholder="Title" 
              value={item.title} 
              onChange={e => {
                const newSyllabus = [...syllabus];
                newSyllabus[i].title = e.target.value;
                setSyllabus(newSyllabus);
              }} 
            />
            <input 
              className="scw-ti" 
              type="date"
              placeholder="YYYY-MM-DD"
              value={item.due} 
              onChange={e => {
                const newSyllabus = [...syllabus];
                newSyllabus[i].due = e.target.value;
                setSyllabus(newSyllabus);
              }} 
            />
          </div>
        ))}
        <button className="p-btn ghost" onClick={() => setSyllabus([...syllabus, { title: "", due: "" }])} style={{ alignSelf: "flex-start" }}>+ Add Item</button>
      </div>
      <button className="p-btn" onClick={handleSubmit} disabled={submitSyllabus.loading} style={{ marginTop: "1rem" }}>
        {submitSyllabus.loading ? "Saving..." : "Save Syllabus"}
      </button>
    </div>
  );
}

export function InstructorFidelity({ courseId }) {
  const { data: fidelityData, loading, refetch } = useApiQuery(`/fidelity?courseId=${courseId}`, { enabled: !!courseId });
  const runFidelity = useApiMutation("/fidelity", "POST");
  const runCases = useApiMutation("/fidelity/cases", "POST");
  const [persona, setPersona] = useState("");
  const [casesList, setCasesList] = useState([{ situation: "", expect: "" }]);
  const [sourceIdsStr, setSourceIdsStr] = useState("");

  const handleRunCases = async () => {
    try {
      await runCases.mutate({ 
        courseId, 
        sourceIds: sourceIdsStr.split(",").map(s => s.trim()).filter(Boolean),
        persona,
        cases: casesList.filter(c => c.situation && c.expect)
      });
      refetch();
    } catch (e) {
      alert(e.error || "Failed to submit fidelity cases");
    }
  };

  const handleRunFidelity = async () => {
    try {
      await runFidelity.mutate({ courseId });
      refetch();
    } catch (e) {
      alert(e.error || "Failed to run fidelity check");
    }
  };

  if (loading) return <p>Loading fidelity report...</p>;

  return (
    <div className="p-panel">
      <h3>Doctrinal Fidelity (Understudy)</h3>
      
      {!fidelityData || fidelityData.error ? (
        <div style={{ marginBottom: "1rem" }}>
          <h4>Configure Fidelity Cases</h4>
          <input className="scw-ti" placeholder="Source IDs (comma-separated)" value={sourceIdsStr} onChange={e => setSourceIdsStr(e.target.value)} style={{ width: "100%", marginBottom: "0.5rem" }} />
          <input className="scw-ti" placeholder="Persona" value={persona} onChange={e => setPersona(e.target.value)} style={{ width: "100%", marginBottom: "0.5rem" }} />
          {casesList.map((c, i) => (
            <div key={i} style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem" }}>
              <input className="scw-ti" placeholder="Situation" value={c.situation} onChange={e => {
                const newList = [...casesList];
                newList[i].situation = e.target.value;
                setCasesList(newList);
              }} style={{ flex: 1 }} />
              <input className="scw-ti" placeholder="Expectation" value={c.expect} onChange={e => {
                const newList = [...casesList];
                newList[i].expect = e.target.value;
                setCasesList(newList);
              }} style={{ flex: 1 }} />
            </div>
          ))}
          <button className="p-btn ghost" onClick={() => setCasesList([...casesList, { situation: "", expect: "" }])} style={{ marginBottom: "0.5rem", display: "block" }}>+ Add Case</button>
          <button className="p-btn ghost" onClick={handleRunCases} disabled={runCases.loading}>
            {runCases.loading ? "Submitting..." : "Submit Cases"}
          </button>
        </div>
      ) : null}

      {fidelityData && !fidelityData.error ? (
        <div>
          <p><strong>Status:</strong> {fidelityData.status}</p>
          {fidelityData.report && (
            <div style={{ marginTop: "1rem" }}>
              <p><strong>Fidelity Score:</strong> {fidelityData.report.fidelity}</p>
              <p><strong>Strict Mode:</strong> {fidelityData.report.strict ? "Yes" : "No"}</p>
              <ul style={{ paddingLeft: "1.5rem", fontSize: "0.9em", color: "var(--p-dim)" }}>
                {fidelityData.runs?.map((ri) => (
                  <li key={i} style={{ marginBottom: "0.5rem" }}>
                    <strong style={{ color: r.verdict === "pass" ? "var(--p-good)" : "var(--p-critical)" }}>{r.verdict}</strong>
                    {" - Grounding: "}{r.grounding}
                    {" | Score: "}{r.score}
                    {r.error && <span style={{ color: "var(--p-critical)" }}> (Error: {r.error})</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <button className="p-btn ghost" onClick={handleRunFidelity} disabled={runFidelity.loading} style={{ marginTop: "1rem" }}>
            {runFidelity.loading ? "Running..." : "Re-run Fidelity Check"}
          </button>
        </div>
      ) : (
        <div>
          <p style={{ color: "var(--p-dim)", marginBottom: "1rem" }}>Run an automated fidelity check against approved doctrine to ensure course accuracy.</p>
          <button className="p-btn" onClick={handleRunFidelity} disabled={runFidelity.loading}>
            {runFidelity.loading ? "Running..." : "Run Fidelity Check"}
          </button>
        </div>
      )}
    </div>
  );
}

export function InstructorAAR({ courseId }) {
  const { data: aarData, loading, refetch } = useApiQuery(`/aar?courseId=${courseId}`, { enabled: !!courseId });
  const generateAar = useApiMutation("/aar", "POST");
  const submitCritiques = useApiMutation("/aar/critiques", "POST");

  const [critiqueArea, setCritiqueArea] = useState("");
  const [critiqueKind, setCritiqueKind] = useState("sustain");
  const [critiqueText, setCritiqueText] = useState("");

  const handleCritiques = async () => {
    try {
      await submitCritiques.mutate({
        courseId,
        critiques: [{ area: critiqueArea, kind: critiqueKind, text: critiqueText }]
      });
      alert("Critiques submitted!");
    } catch (e) {
      alert(e.error || "Failed to submit critiques");
    }
  };

  const handleGenerate = async () => {
    try {
      await generateAar.mutate({ courseId });
      refetch();
    } catch (e) {
      alert(e.error || "Failed to generate AAR");
    }
  };

  if (loading) return <p>Loading AAR...</p>;

  return (
    <div className="p-panel">
      <h3>After-Action Review (Hotwash)</h3>
      
      <div style={{ marginBottom: "1rem" }}>
        <h4>Submit Critiques</h4>
        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem" }}>
          <input className="scw-ti" placeholder="Area" value={critiqueArea} onChange={e => setCritiqueArea(e.target.value)} style={{ flex: 1 }} />
          <select className="scw-ti" value={critiqueKind} onChange={e => setCritiqueKind(e.target.value)}>
            <option value="sustain">Sustain</option>
            <option value="improve">Improve</option>
          </select>
        </div>
        <textarea className="scw-ti" placeholder="Critique text" value={critiqueText} onChange={e => setCritiqueText(e.target.value)} rows={2} style={{ width: "100%", marginBottom: "0.5rem" }} />
        <button className="p-btn ghost" onClick={handleCritiques} disabled={submitCritiques.loading}>
          {submitCritiques.loading ? "Submitting..." : "Submit Critique"}
        </button>
      </div>

      {aarData && !aarData.error ? (
        <div>
          <p><strong>Source:</strong> {aarData.source}</p>
          <div className="p-rationale" style={{ margin: "1rem 0" }}>
            <span className="p-rlab">Memo</span>
            <pre style={{ whiteSpace: "pre-wrap", margin: 0, font: "inherit", fontSize: "0.9em" }}>{aarData.memo}</pre>
          </div>
          <button className="p-btn ghost" onClick={handleGenerate} disabled={generateAar.loading}>
            {generateAar.loading ? "Generating..." : "Regenerate AAR"}
          </button>
        </div>
      ) : (
        <div>
          <p style={{ color: "var(--p-dim)", marginBottom: "1rem" }}>Generate an after-action review from learner critiques.</p>
          <button className="p-btn" onClick={handleGenerate} disabled={generateAar.loading}>
            {generateAar.loading ? "Generating..." : "Generate AAR"}
          </button>
        </div>
      )}
    </div>
  );
}

export function RubricsView() {
  const [sourceId, setSourceId] = useState("");
  const [taskCode, setTaskCode] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskCondition, setTaskCondition] = useState("");
  const [taskStandard, setTaskStandard] = useState("");
  const [taskSteps, setTaskSteps] = useState("");

  const [generatedRubricId, setGeneratedRubricId] = useState(null);

  const generateRubric = useApiMutation("/rubrics/generate", "POST");
  const approveRubric = useApiMutation(`/rubrics/${generatedRubricId}/approve`, "POST");
  const { data: rubricData } = useApiQuery(`/rubrics/${generatedRubricId}`, { enabled: !!generatedRubricId });

  const handleGenerate = async () => {
    if (!sourceId || !taskCode) return;
    try {
      const res = await generateRubric.mutate({
        sourceId,
        task: {
          code: taskCode,
          title: taskTitle,
          condition: taskCondition,
          standard: taskStandard,
          performanceSteps: taskSteps.split("\n").filter(Boolean)
        }
      });
      setGeneratedRubricId(res.id);
    } catch (e) {
      alert(e.error || "Failed to generate rubric");
    }
  };

  const handleApprove = async () => {
    try {
      await approveRubric.mutate();
      alert("Rubric approved!");
    } catch (e) {
      alert(e.error || "Failed to approve rubric");
    }
  };

  return (
    <div>
      <h2 className="p-h">Rubric Generation (Rubricon)</h2>
      <div className="p-panel">
        <h3>Generate New Rubric</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <input className="scw-ti" placeholder="Source ID" value={sourceId} onChange={e => setSourceId(e.target.value)} />
          <input className="scw-ti" placeholder="Task Code (e.g. TASK-01)" value={taskCode} onChange={e => setTaskCode(e.target.value)} />
          <input className="scw-ti" placeholder="Task Title" value={taskTitle} onChange={e => setTaskTitle(e.target.value)} />
          <input className="scw-ti" placeholder="Task Condition" value={taskCondition} onChange={e => setTaskCondition(e.target.value)} />
          <input className="scw-ti" placeholder="Task Standard" value={taskStandard} onChange={e => setTaskStandard(e.target.value)} />
          <textarea className="scw-ti" placeholder="Performance Steps (one per line)" value={taskSteps} onChange={e => setTaskSteps(e.target.value)} rows={4} />
          
          <button className="p-btn" onClick={handleGenerate} disabled={generateRubric.loading}>
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
                  {rubricData.traceability.ungrounded?.length > 0 && (
                    <p style={{ color: "var(--p-critical)", fontSize: "0.85em" }}>
                      <strong>Ungrounded elements:</strong> {rubricData.traceability.ungrounded.join(", ")}
                    </p>
                  )}
                </div>
              )}
              {rubricData.rubric?.flagged && (
                <p style={{ color: "var(--p-critical)" }}><strong>Flagged:</strong> {rubricData.rubric.flagReason || "Yes"}</p>
              )}
              
              <pre style={{ whiteSpace: "pre-wrap", fontSize: "0.85em", background: "var(--p-surface-2)", padding: "1rem", overflowX: "auto" }}>
                {JSON.stringify(rubricData.rubric || rubricData, null, 2)}
              </pre>
              {rubricData.status === "PENDING" && (
                <button className="p-btn" onClick={handleApprove} disabled={approveRubric.loading} style={{ marginTop: "1rem" }}>
                  {approveRubric.loading ? "Approving..." : "Approve Rubric"}
                </button>
              )}
            </div>
          ) : (
            <p>Loading rubric...</p>
          )}
        </div>
      )}
    </div>
  );
}
