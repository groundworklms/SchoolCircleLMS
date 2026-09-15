'use client';

import { useState } from 'react';
import { useApiQuery, useApiMutation } from '../_learning/useLearning';

export function LearnerTutor({ sourceId }) {
  const [history, setHistory] = useState([]);
  const [input, setInput] = useState("");
  const askTutor = useApiMutation("/tutor", "POST");

  const handleAsk = async () => {
    if (!input.trim()) return;
    const q = input;
    setInput("");
    
    // Add optimistic user turn
    const newHistory = [...history, { role: "user", text: q }];
    setHistory(newHistory);
    
    try {
      const res = await askTutor.mutate({ question: q, sourceIds: [sourceId], history });
      setHistory([
        ...newHistory,
        { role: "assistant", text: res.answer, citations: res.citations, refused: res.refused, reason: res.reason }
      ]);
    } catch (e) {
      setHistory([...newHistory, { role: "assistant", text: e?.error || "Error communicating with Tutor.", isError: true }]);
    }
  };

  return (
    <div className="p-panel" style={{ marginTop: "2rem" }}>
      <h3>Course Tutor (Sourcerer)</h3>
      <p style={{ color: "var(--p-dim)", fontSize: "0.85em", marginBottom: "1rem" }}>
        Ask questions about the approved course material. I will only answer using approved citations.
      </p>
      
      <div style={{ maxHeight: "300px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "1rem", marginBottom: "1rem" }}>
        {history.map((msg, i) => (
          <div key={i} style={{ 
            alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
            background: msg.role === "user" ? "var(--p-accent)" : "var(--p-surface-2)",
            color: msg.role === "user" ? "#fff" : "var(--p-text)",
            padding: "0.75rem 1rem",
            borderRadius: "12px",
            maxWidth: "80%"
          }}>
            <p style={{ margin: 0 }}>{msg.text}</p>
            {msg.refused && msg.reason && (
              <p style={{ fontSize: "0.8em", color: "var(--p-critical)", marginTop: "0.5rem", marginBottom: 0 }}>
                Refused: {msg.reason}
              </p>
            )}
            {msg.citations?.length > 0 && (
              <div style={{ marginTop: "0.5rem", fontSize: "0.75em", opacity: 0.8 }}>
                {msg.citations.map((cj) => (
                  <span key={j} style={{ display: "inline-block", background: "rgba(0,0,0,0.1)", padding: "0.1rem 0.4rem", borderRadius: "4px", marginRight: "0.25rem", marginBottom: "0.25rem" }}>
                    {c.source || "Source"} {c.page ? `p. ${c.page}` : ""}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
        {askTutor.loading && (
          <div style={{ alignSelf: "flex-start", background: "var(--p-surface-2)", padding: "0.75rem 1rem", borderRadius: "12px" }}>
            Thinking...
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: "0.5rem" }}>
        <input 
          className="scw-ti" 
          style={{ flex: 1, padding: "0.5rem" }} 
          placeholder="Ask a question..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAsk()}
        />
        <button className="p-btn" onClick={handleAsk} disabled={askTutor.loading || !input.trim()}>
          Ask
        </button>
      </div>
    </div>
  );
}

export function SourceViewer({ sourceId }) {
  const { data: sourceData, loading, error } = useApiQuery(`/sources/${sourceId}`);
  const [open, setOpen] = useState(false);

  if (error) {
    return <p style={{ color: "var(--p-critical)" }}>{error?.error || "Error loading source"}</p>;
  }

  if (loading || !sourceData) return <p>Loading source...</p>;

  return (
    <div className="p-panel" style={{ marginTop: "2rem" }}>
      <h3>Source Document: {sourceData.title || sourceId}</h3>
      {!open ? (
        <button className="p-btn ghost" onClick={() => setOpen(true)}>Open Document</button>
      ) : (
        <div>
          <button className="p-btn ghost" onClick={() => setOpen(false)} style={{ marginBottom: "1rem" }}>Close Document</button>
          <div style={{ background: "var(--p-surface-2)", padding: "1rem", borderRadius: "8px", maxHeight: "400px", overflowY: "auto", fontSize: "0.9em", whiteSpace: "pre-wrap" }}>
            {sourceData.pages?.length > 0 ? (
              sourceData.pages.map((p) => (
                <div key={p.page} style={{ marginBottom: "1rem" }}>
                  <strong style={{ display: "block", marginBottom: "0.25rem", color: "var(--p-dim)" }}>Page {p.page}</strong>
                  <p style={{ margin: 0 }}>{p.text}</p>
                </div>
              ))
            ) : sourceData.chunks?.length > 0 ? (
              sourceData.chunks.map((ci) => (
                <div key={i} style={{ marginBottom: "1rem" }}>
                  <strong style={{ display: "block", marginBottom: "0.25rem", color: "var(--p-dim)" }}>Chunk {i + 1}</strong>
                  <p style={{ margin: 0 }}>{c.text}</p>
                </div>
              ))
            ) : (
              sourceData.text || "No content available."
            )}
          </div>
        </div>
      )}
    </div>
  );
}
