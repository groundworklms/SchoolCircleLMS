"use client";

import { useEffect, useRef, useState } from "react";
import { useApiMutation, useApiQuery } from "./use-learning";
import {
  exactSourcePassages,
  nonEmptyString,
  resolveTutorCitationLocator,
  sourceIdentityMatches,
} from "./tutor-locator.mjs";

type TutorCitation = {
  source?: unknown;
  sourceId?: unknown;
  page?: unknown;
};

type TutorMessage = {
  role: "user" | "assistant";
  text: string;
  citations?: TutorCitation[];
  refused?: boolean;
  reason?: unknown;
  isError?: boolean;
};

type SourcePage = {
  page?: unknown;
  text?: unknown;
};

type SourceData = {
  id?: unknown;
  status?: unknown;
  title?: unknown;
  sourceId?: unknown;
  pages?: SourcePage[];
  chunks?: SourcePage[];
};

type SelectedCitation = {
  source: string;
  sourceLabel: string | null;
  recordId: string | null;
  sourceId: string | null;
  page: number | null;
  unavailableReason: string | null;
};

function errorText(error: any, fallback: string): string {
  return nonEmptyString(error?.error) || nonEmptyString(error?.message) || fallback;
}

function CitationLocator({
  citation,
  onClose,
}: {
  citation: SelectedCitation;
  onClose: () => void;
}) {
  const sourcePath = citation.recordId
    ? `/sources/${encodeURIComponent(citation.recordId)}`
    : "/sources";
  const { data: sourceData, loading, error } = useApiQuery<SourceData>(sourcePath, {
    enabled: Boolean(citation.recordId && citation.page !== null && !citation.unavailableReason),
  });
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const titleId = "tutor-citation-locator-title";
  const descriptionId = "tutor-citation-locator-description";

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  let body;
  if (citation.unavailableReason) {
    body = (
      <p className="learning-critical" role="status" aria-live="polite">
        {citation.unavailableReason}
      </p>
    );
  } else if (!citation.recordId || citation.page === null) {
    body = (
      <p className="learning-critical" role="status" aria-live="polite">
        Locator unavailable: the citation has no exact source record and page.
      </p>
    );
  } else if (loading) {
    body = <p role="status" aria-live="polite">Loading approved source locator...</p>;
  } else if (error) {
    body = (
      <p className="learning-critical" role="status" aria-live="polite">
        Unable to load approved source locator: {errorText(error, "source request failed")}
      </p>
    );
  } else if (!sourceData) {
    body = (
      <p className="learning-critical" role="status" aria-live="polite">
        Locator unavailable: the approved source returned no document.
      </p>
    );
  } else if (!sourceIdentityMatches(sourceData, citation)) {
    body = (
      <p className="learning-critical" role="status" aria-live="polite">
        Locator unavailable: the returned source did not match the requested source record.
      </p>
    );
  } else if (sourceData.status !== "APPROVED") {
    body = (
      <p className="learning-critical" role="status" aria-live="polite">
        Locator unavailable: this source is not approved for learners.
      </p>
    );
  } else {
    const passages: string[] = exactSourcePassages(sourceData, citation.page);
    body =
      passages.length > 0 ? (
        <div
          className="source-document"
          style={{
            background: "var(--p-bg)",
            borderLeft: "3px solid var(--p-good)",
            borderRadius: "8px",
            padding: "1rem",
          }}
        >
          {passages.map((passage, index) => (
            <p key={index} style={{ margin: index === passages.length - 1 ? 0 : "0 0 1rem" }}>
              {passage}
            </p>
          ))}
        </div>
      ) : (
        <p className="learning-critical" role="status" aria-live="polite">
          Locator unavailable: approved source {citation.recordId} has no page {citation.page}.
        </p>
      );
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 90,
        display: "grid",
        placeItems: "center",
        padding: "1.2rem",
        background: "rgba(0, 0, 0, 0.4)",
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        style={{
          width: "100%",
          maxWidth: "36rem",
          maxHeight: "calc(100vh - 2.4rem)",
          overflowY: "auto",
          background: "var(--p-surface)",
          borderRadius: "var(--p-radius)",
          boxShadow: "var(--p-shadow-lift)",
          padding: "1.5rem 1.7rem",
        }}
      >
        <button
          ref={closeButtonRef}
          type="button"
          className="p-btn ghost"
          onClick={onClose}
          style={{ marginBottom: "1rem" }}
        >
          Close locator
        </button>
        <h2 id={titleId} style={{ margin: "0 0 0.5rem", fontSize: "1.1rem" }}>
          Approved source locator
        </h2>
        <p id={descriptionId} className="learning-dim" style={{ margin: "0 0 1rem" }}>
          Source label: {citation.sourceLabel || "unavailable"} · record id{" "}
          {citation.recordId || "unavailable"} ·{" "}
          {citation.page === null ? "page unavailable" : `page ${citation.page}`}
        </p>
        <p className="learning-dim" style={{ margin: "0 0 1rem", fontSize: "0.8em" }}>
          Backend locator: {citation.source}
        </p>
        {body}
      </div>
    </div>
  );
}

export function LearnerTutor({ sourceId }: { sourceId: string }) {
  const [history, setHistory] = useState<TutorMessage[]>([]);
  const [input, setInput] = useState("");
  const [selectedCitation, setSelectedCitation] = useState<SelectedCitation | null>(null);
  const askInFlight = useRef(false);
  const citationReturnRef = useRef<HTMLButtonElement | null>(null);
  const askTutor = useApiMutation<any>("/tutor", "POST");

  const closeCitation = () => {
    setSelectedCitation(null);
    const invokingCitation = citationReturnRef.current;
    citationReturnRef.current = null;
    invokingCitation?.focus();
  };

  useEffect(() => {
    if (!selectedCitation) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeCitation();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [selectedCitation]);

  const handleAsk = async () => {
    if (askInFlight.current || askTutor.loading) return;
    const question = input.trim();
    if (!question) return;
    askInFlight.current = true;
    setInput("");
    const newHistory: TutorMessage[] = [...history, { role: "user", text: question }];
    setHistory(newHistory);

    try {
      const result = await askTutor.mutate({
        question,
        sourceIds: [sourceId],
        history,
      });
      const refused = Boolean(result?.refused);
      setHistory([
        ...newHistory,
        {
          role: "assistant",
          text:
            nonEmptyString(result?.answer) ||
            (refused
              ? "The tutor refused to answer from the approved course material."
              : "Tutor returned no answer."),
          // A refusal is terminal for this turn. Never render citations a
          // backend/model accidentally includes alongside a refusal.
          citations: refused
            ? []
            : Array.isArray(result?.citations)
              ? result.citations
              : [],
          refused,
          reason: result.reason,
        },
      ]);
    } catch (error: any) {
      setHistory([
        ...newHistory,
        {
          role: "assistant",
          text: errorText(error, "Error communicating with Tutor."),
          isError: true,
        },
      ]);
    } finally {
      askInFlight.current = false;
    }
  };

  return (
    <div className="p-panel" style={{ marginTop: "2rem" }}>
      <h3>Course Tutor (Sourcerer)</h3>
      <p className="learning-dim" style={{ fontSize: "0.85em", marginBottom: "1rem" }}>
        Ask questions about the approved course material. I will only answer using approved citations.
      </p>

      <div className="tutor-history">
        {history.map((message, index) => (
          <div
            key={index}
            className={`tutor-message ${message.role}`}
          >
            <p style={{ margin: 0 }}>{message.text}</p>
            {message.refused && (
              <p className="learning-critical" style={{ fontSize: "0.8em", marginTop: "0.5rem", marginBottom: 0 }}>
                Refused: {nonEmptyString(message.reason) || "The tutor did not provide a supported answer."}
              </p>
            )}
            {!message.refused && message.citations && message.citations.length > 0 && (
              <div style={{ marginTop: "0.5rem", fontSize: "0.75em", opacity: 0.8 }}>
                {message.citations.map((citation, citationIndex) => (
                  (() => {
                    const locator = resolveTutorCitationLocator(citation);
                    const hasLocator = Boolean(locator.recordId && locator.page !== null);
                    return (
                      <button
                        className="tutor-citation"
                        key={citationIndex}
                        type="button"
                        aria-label={
                          hasLocator
                            ? `Open ${locator.sourceLabel || locator.source}, page ${locator.page}`
                            : "Citation locator unavailable"
                        }
                        onClick={(event) => {
                          citationReturnRef.current = event.currentTarget;
                          setSelectedCitation(locator);
                        }}
                        style={{
                          border: 0,
                          cursor: "pointer",
                          font: "inherit",
                          color: "inherit",
                        }}
                      >
                        {locator.sourceLabel || locator.source}{" "}
                        {locator.page === null ? "(locator unavailable)" : `p. ${locator.page}`}
                      </button>
                    );
                  })()
                ))}
              </div>
            )}
          </div>
        ))}
        {askTutor.loading && <div className="tutor-message assistant">Thinking...</div>}
      </div>

      <div style={{ display: "flex", gap: "0.5rem" }}>
        <input
          className="scw-ti"
          style={{ flex: 1, padding: "0.5rem" }}
          placeholder="Ask a question..."
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void handleAsk();
            }
          }}
        />
        <button className="p-btn" onClick={() => void handleAsk()} disabled={askTutor.loading || askInFlight.current || !input.trim()}>
          Ask
        </button>
      </div>
      {selectedCitation && <CitationLocator citation={selectedCitation} onClose={closeCitation} />}
    </div>
  );
}

export function SourceViewer({ sourceId }: { sourceId: string }) {
  const { data: sourceData, loading, error } = useApiQuery<any>(`/sources/${sourceId}`);
  const [open, setOpen] = useState(false);

  if (error) {
    return <p className="learning-critical">{error?.error || "Error loading source"}</p>;
  }
  if (loading || !sourceData) return <p>Loading source...</p>;

  return (
    <div className="p-panel" style={{ marginTop: "2rem" }}>
      <h3>Source Document: {sourceData.title || sourceId}</h3>
      {!open ? (
        <button className="p-btn ghost" onClick={() => setOpen(true)}>Open Document</button>
      ) : (
        <div>
          <button className="p-btn ghost" onClick={() => setOpen(false)} style={{ marginBottom: "1rem" }}>
            Close Document
          </button>
          <div className="source-document">
            {sourceData.pages?.length > 0 ? (
              sourceData.pages.map((page: any) => (
                <div key={page.page} style={{ marginBottom: "1rem" }}>
                  <strong className="learning-dim" style={{ display: "block", marginBottom: "0.25rem" }}>
                    Page {page.page}
                  </strong>
                  <p style={{ margin: 0 }}>{page.text}</p>
                </div>
              ))
            ) : sourceData.chunks?.length > 0 ? (
              sourceData.chunks.map((chunk: any, index: number) => (
                <div key={index} style={{ marginBottom: "1rem" }}>
                  <strong className="learning-dim" style={{ display: "block", marginBottom: "0.25rem" }}>
                    Chunk {index + 1}
                  </strong>
                  <p style={{ margin: 0 }}>{chunk.text}</p>
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