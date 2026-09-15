'use client';

import { useEffect, useState } from 'react';

/* Pieces used by more than one screen. */

function band(v) {
  if (v >= 80) return { color: 'var(--p-good)', label: 'STRONG' };
  if (v >= 65) return { color: 'var(--p-warning)', label: 'WATCH' };
  return { color: 'var(--p-critical)', label: 'AT RISK' };
}

function MasteryPanel({ title, topics, note }) {
  const [asTable, setAsTable] = useState(false);
  const [grown, setGrown] = useState(false);

  useEffect(() => {
    setGrown(false);
    const t = setTimeout(() => setGrown(true), 60);
    return () => clearTimeout(t);
  }, [topics]);

  return (
    <div className="p-panel">
      <h3>
        {title}
        <button
          className="p-btn ghost"
          style={{ float: 'right', fontSize: '0.9em', padding: '0.15rem 0.6rem', textTransform: 'none', letterSpacing: 0 }}
          onClick={() => setAsTable((v) => !v)}
        >
          {asTable ? 'Chart view' : 'Table view'}
        </button>
      </h3>

      {asTable ? (
        <div className="p-tablewrap">
          <table className="p-table">
            <thead>
              <tr>
                <th>Topic</th>
                <th className="p-num">Mastery</th>
                <th>Band</th>
              </tr>
            </thead>
            <tbody>
              {topics.map((t) => (
                <tr key={t.name}>
                  <td>{t.name}</td>
                  <td className="p-num">{t.mastery}%</td>
                  <td>{band(t.mastery).label}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <div className="p-chart">
            {topics.map((t) => {
              const b = band(t.mastery);
              return (
                <div className="p-row" key={t.name}>
                  <span className="p-rowlab">{t.name}</span>
                  <div className="p-track">
                    <div className="p-bar" style={{ width: grown ? `${t.mastery}%` : '0%', background: b.color }} />
                  </div>
                  <span className="p-rowval">
                    <span>{t.mastery}%</span>
                    <span className="p-band" style={{ color: b.color }}>{b.label}</span>
                  </span>
                </div>
              );
            })}
          </div>
          <div className="p-axis">
            <span />
            <span className="p-axisin">
              <span>0%</span>
              <span>50%</span>
              <span>100%</span>
            </span>
            <span />
          </div>
        </>
      )}
      {note && <p className="p-src">{note}</p>}
    </div>
  );
}

/* Browser speech synthesis: real narration, no API key, no network.
   Works air-gapped. Lower quality than a commercial TTS, but it means the
   speech capability is never a hard blocker. */
function useNarration() {
  const [speaking, setSpeaking] = useState(false);
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    setSupported(typeof window !== 'undefined' && 'speechSynthesis' in window);
    return () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const speak = (text) => {
    if (!supported) return;
    const synth = window.speechSynthesis;
    if (synth.speaking) {
      synth.cancel();
      setSpeaking(false);
      return;
    }
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.95;
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    setSpeaking(true);
    synth.speak(u);
  };

  return { speak, speaking, supported };
}

export { band, MasteryPanel, useNarration };
