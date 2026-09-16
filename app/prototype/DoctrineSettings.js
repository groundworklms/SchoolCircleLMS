'use client';

/**
 * Settings -> Doctrine engine.
 *
 * The grounding engine is a physical board on a USB cable that moves between
 * laptops. So the default view is not a URL field: it is one button that looks
 * for it, and a plain answer about whether it is answering and which
 * publications it is holding. Typing an address is the fallback, not the path.
 *
 * Nothing here is a credential -- an Anchor address is an address -- so there
 * is no passphrase and no masked field, unlike Settings -> Generation model.
 */

import { useCallback, useEffect, useState } from 'react';
import { authFetch } from '../../lib/firebase';
import './doctrine-settings.css';

const ENDPOINT = '/api/learning/doctrine-settings';

function errText(error, fallback) {
  return error?.error || error?.message || fallback;
}

function CorpusSummary({ corpus }) {
  if (!corpus?.publications?.length) return null;
  const shown = corpus.publications.slice(0, 6);
  const rest = corpus.publications.length - shown.length;
  return (
    <p className="doctrine-note">
      {corpus.totalChunks ? `${corpus.totalChunks.toLocaleString()} passages · ` : ''}
      {shown.map((pub) => pub.pubId).join(', ')}
      {rest > 0 ? `, and ${rest} more` : ''}
    </p>
  );
}

function Candidate({ entry, onUse, busy, current }) {
  return (
    <li className={`doctrine-candidate${entry.reachable ? ' found' : ''}`}>
      <div className="doctrine-candidate-body">
        <span className="doctrine-candidate-name">{entry.label}</span>
        <span className="doctrine-candidate-url">{entry.baseUrl}</span>
        {entry.reachable ? (
          <>
            <span className="doctrine-candidate-state ok">Answering</span>
            <CorpusSummary corpus={entry.corpus} />
            {entry.corpusError && <p className="doctrine-note">{entry.corpusError}</p>}
          </>
        ) : (
          <span className="doctrine-candidate-state">{entry.error || 'No response.'}</span>
        )}
      </div>
      {entry.reachable && entry.baseUrl !== current && (
        <button type="button" className="p-btn" onClick={() => onUse(entry.baseUrl)} disabled={busy}>
          Use this
        </button>
      )}
      {entry.reachable && entry.baseUrl === current && (
        <span className="doctrine-candidate-state ok">In use</span>
      )}
    </li>
  );
}

export function DoctrineSettings() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [baseUrl, setBaseUrl] = useState('');
  const [manual, setManual] = useState(false);
  const [detected, setDetected] = useState(null);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [saved, setSaved] = useState(null);

  const adopt = useCallback((next) => {
    setSettings(next);
    setBaseUrl(next.baseUrl || next.active?.baseUrl || '');
  }, []);

  const request = useCallback(async (method, body) => {
    const res = await authFetch(ENDPOINT, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const json = await res.json();
    if (!res.ok) throw json;
    return json;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const json = await request('GET');
        if (!cancelled) adopt(json.settings);
      } catch (error) {
        if (!cancelled) setLoadError(error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [adopt, request]);

  async function detect() {
    setBusy(true);
    setErr(null);
    setSaved(null);
    try {
      const json = await request('POST');
      adopt(json.settings);
      setDetected(json.detected);
      if (!json.detected?.found) {
        setErr('No engine answered. Check the USB cable is in the device-mode port.');
      }
    } catch (error) {
      setErr(errText(error, 'The search could not be run.'));
    } finally {
      setBusy(false);
    }
  }

  async function save(url) {
    const next = (url || baseUrl).trim();
    if (!next) return;
    setBusy(true);
    setErr(null);
    setSaved(null);
    try {
      const json = await request('PUT', {
        baseUrl: next,
        ...(Number.isInteger(settings?.version) ? { expectedVersion: settings.version } : {}),
      });
      adopt(json.settings);
      setSaved('Saved. Grounded answers now come from this engine.');
    } catch (error) {
      setErr(errText(error, 'That address could not be saved.'));
    } finally {
      setBusy(false);
    }
  }

  async function revert() {
    setBusy(true);
    setErr(null);
    setSaved(null);
    try {
      const json = await request('DELETE');
      adopt(json.settings);
      setSaved('Reverted to the engine this deployment is configured with.');
    } catch (error) {
      setErr(errText(error, 'That could not be reverted.'));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="s-settings-p">Loading…</p>;
  if (loadError) {
    return (
      <p className="s-shell-error" role="alert">
        {errText(loadError, 'Could not load the doctrine engine settings.')}
      </p>
    );
  }

  const active = settings?.active;
  const current = active?.baseUrl || '';

  return (
    <div className="doctrine-settings">
      <p className="s-settings-p">
        Where grounded answers and citations come from. With the Orin plugged in over USB this
        finds it on its own — no key and no tunnel needed.
      </p>

      <div className={`doctrine-status${active?.ready ? ' ok' : ''}`}>
        <span className="doctrine-status-dot" aria-hidden="true" />
        <div>
          <p className="doctrine-status-line">
            {active?.ready ? 'Connected' : 'Not connected'}
            {active?.ready && current ? ` · ${current}` : ''}
          </p>
          <p className="doctrine-note">
            {active?.ready
              ? (active.source === 'setting'
                ? 'Set here in Settings.'
                : 'From this deployment’s configuration (DOCTRINE_BASE_URL).')
              : (active?.reason || 'No doctrine engine is configured.')}
          </p>
        </div>
      </div>

      {err && <p className="s-shell-error" role="alert">{err}</p>}
      {saved && <p className="p-check ok" role="status">{saved}</p>}

      <div className="p-btnrow">
        <button type="button" className="p-btn" onClick={detect} disabled={busy}>
          {busy ? 'Looking…' : 'Find the Orin'}
        </button>
        {settings?.configured && (
          <button type="button" className="p-btn ghost" onClick={revert} disabled={busy}>
            Use deployment default
          </button>
        )}
      </div>

      {detected?.results?.length > 0 && (
        <ul className="doctrine-candidates">
          {detected.results.map((entry) => (
            <Candidate
              key={entry.baseUrl}
              entry={entry}
              onUse={save}
              busy={busy}
              current={current}
            />
          ))}
        </ul>
      )}

      <button
        type="button"
        className="doctrine-disclose"
        onClick={() => setManual((open) => !open)}
        aria-expanded={manual}
      >
        {manual ? 'Hide manual address' : 'Enter an address manually'}
      </button>

      {manual && (
        <form
          className="doctrine-form"
          onSubmit={(event) => { event.preventDefault(); save(); }}
        >
          <label>
            <span>Doctrine engine address</span>
            <input
              type="url"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="http://192.168.55.1:8000"
              disabled={busy}
              required
            />
          </label>
          <p className="doctrine-note">
            The Orin over USB is <code>http://192.168.55.1:8000</code>. A laptop running
            <code> ops/tunnel.sh</code> is <code>http://localhost:8000</code>.
          </p>
          <div className="p-btnrow">
            <button type="submit" className="p-btn" disabled={busy || !baseUrl.trim()}>
              Save address
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

export default DoctrineSettings;
