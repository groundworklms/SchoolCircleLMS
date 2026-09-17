'use client';

/**
 * Settings -> Doctrine engine.
 *
 * The grounding engine is a physical board on a USB cable that moves between
 * laptops. So the default view is not a URL field: it is one button that looks
 * for it, and a plain answer about whether it is answering and which
 * publications it is holding.
 *
 * Which of the two controls is "the path" DEPENDS ON WHERE THIS IS RUNNING, and
 * the copy must not pretend otherwise. `Find the Orin` POSTs to
 * /api/learning/doctrine-settings, and the sweep in lib/doctrine-detect.js runs
 * SERVER-SIDE from that route -- not in the browser. Its first candidate,
 * http://192.168.55.1:8000, is the Orin's point-to-point USB device-mode
 * address, reachable only from the single laptop the board is cabled to.
 *
 *   - SchoolCircle running locally on that laptop: the sweep is the path, and
 *     genuinely needs no key and no tunnel.
 *   - Hosted (Firebase App Hosting): the server is in Google's network and can
 *     never route to a USB address, so the sweep cannot succeed and typing a
 *     reachable address -- a tunnel -- is the path.
 *
 * Measured 16 Sep 2026: on the hosted deployment the sweep changed nothing and
 * the panel still reported the configured tunnel returning 502. The feature is
 * real, its scope is narrower than "finds it on its own", and the copy says so.
 *
 * Nothing here is a credential -- an Anchor address is an address -- so there
 * is no passphrase and no masked field, unlike Settings -> Generation model.
 *
 * The status light is a live probe, not a reading of the configuration. It used
 * to be the latter: a green dot and "Connected" meant only that
 * DOCTRINE_BASE_URL was SET, so the panel stayed green through two days of a
 * dead endpoint while every grounded answer failed. This is the one control an
 * operator checks before walking on stage, so green now requires that the
 * engine answered /api/health, reported every model loaded, and is holding a
 * corpus -- and anything less says so in words.
 */

import { useCallback, useEffect, useState } from 'react';
import { authFetch } from '../../lib/firebase';
import './doctrine-settings.css';

const ENDPOINT = '/api/learning/doctrine-settings';
const HEALTH_ENDPOINT = '/api/learning/doctrine-health';

// Only `healthy` earns the green dot. `unconfigured` keeps the neutral grey it
// has always had, because "nothing is set up" is not a fault.
const STATE_CLASS = {
  healthy: 'ok',
  degraded: 'warn',
  unreachable: 'bad',
  unconfigured: '',
};

function errText(error, fallback) {
  return error?.error || error?.message || fallback;
}

/** Whole seconds of uptime as something a person reads at a glance. */
function uptimeText(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours) return `up ${hours}h ${minutes}m`;
  if (minutes) return `up ${minutes}m`;
  return 'up under a minute';
}

/**
 * What the engine is actually holding. The publication COUNT is here on
 * purpose: "it answered" does not distinguish a loaded board from an empty
 * one, and pointing the demo at a freshly reflashed Orin is a realistic way to
 * lose an afternoon.
 */
function CorpusSummary({ corpus }) {
  if (!corpus?.publications?.length) return null;
  const shown = corpus.publications.slice(0, 6);
  const rest = corpus.publications.length - shown.length;
  return (
    <p className="doctrine-note">
      {corpus.totalChunks ? `${corpus.totalChunks.toLocaleString()} passages · ` : ''}
      {corpus.publications.length} publication{corpus.publications.length === 1 ? '' : 's'} ·{' '}
      {shown.map((pub) => pub.pubId).join(', ')}
      {rest > 0 ? `, and ${rest} more` : ''}
    </p>
  );
}

/**
 * The live verdict.
 *
 * Every branch names what was observed rather than what is configured. While a
 * check is in flight with no previous result the dot stays neutral -- "we do
 * not know yet" must never look like "it works".
 *
 * Unreachable is written as a ROUTINE state, because it is one. The engine is a
 * board on a USB cable that moves between laptops, and a quick tunnel gets a new
 * hostname every time it restarts -- so a stale address is the normal case on a
 * demo day, not a crash. The panel therefore says what to do about it, and names
 * which of the two remedies actually applies where: the sweep is server-side, so
 * it only finds the board when the server IS the laptop holding it. Hosted, the
 * address has to be typed.
 */
function HealthPanel({ health, checking, sourceNote, onRecheck, onEnterAddress }) {
  const state = health?.state;
  const endpoints = health?.endpoints || null;
  // A route we watched come back 404, not one we simply could not ask about.
  const missing = endpoints
    ? Object.entries(endpoints).filter(([, present]) => present === false).map(([name]) => name)
    : [];
  const present = endpoints
    ? Object.entries(endpoints).filter(([, value]) => value === true).map(([name]) => name)
    : [];
  const uptime = uptimeText(health?.uptimeS);

  return (
    <div className={`doctrine-status ${health ? STATE_CLASS[state] || '' : ''}`}>
      <span className="doctrine-status-dot" aria-hidden="true" />
      <div className="doctrine-status-body">
        <p className="doctrine-status-line" role="status">
          {checking && !health ? 'Checking…' : health?.headline || 'Not checked'}
          {health?.baseUrl ? ` · ${health.baseUrl}` : ''}
        </p>

        <p className="doctrine-note">
          {checking && !health
            ? 'Asking the engine whether it answers.'
            : (health?.detail || sourceNote)}
        </p>

        {health?.problems?.length > 0 && (
          <ul className="doctrine-problems">
            {health.problems.map((problem) => <li key={problem}>{problem}</li>)}
          </ul>
        )}

        {health?.corpus && <CorpusSummary corpus={health.corpus} />}

        {(present.length > 0 || missing.length > 0 || uptime) && (
          <p className="doctrine-note">
            {present.length > 0 ? `serves /api/${present.join(' · /api/')}` : ''}
            {missing.length > 0
              ? `${present.length ? ' · ' : ''}missing /api/${missing.join(' · /api/')}`
              : ''}
            {uptime ? `${present.length || missing.length ? ' · ' : ''}${uptime}` : ''}
          </p>
        )}

        {(state === 'unreachable' || state === 'unconfigured') && (
          <p className="doctrine-note">
            {state === 'unreachable'
              ? 'Nothing is answering there. The board moves between laptops, and a tunnel '
                + 'takes a new hostname every time it restarts, so a saved address goes stale '
                + 'on its own. '
              : 'No address is set yet. '}
            Try <strong>Find the Orin</strong> below — it probes the USB and local addresses from
            the server this app runs on, so it only finds the board if that server is the machine
            it is plugged into. On a hosted deployment it cannot be, so typing the current address
            in is the normal path rather than the fallback.
          </p>
        )}

        <div className="p-btnrow">
          <button
            type="button"
            className="doctrine-disclose"
            onClick={onRecheck}
            disabled={checking}
          >
            {checking ? 'Checking…' : 'Check again'}
          </button>
          {(state === 'unreachable' || state === 'unconfigured') && (
            <button type="button" className="doctrine-disclose" onClick={onEnterAddress}>
              Enter an address manually
            </button>
          )}
        </div>
      </div>
    </div>
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

  // The live probe, kept apart from the configuration read so the address is on
  // screen immediately and a hanging engine can only delay this one line.
  const [health, setHealth] = useState(null);
  const [checking, setChecking] = useState(false);

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

  /**
   * Run the probe. Resolves either way: a failure to even ASK counts as
   * unreachable, never as nothing. Failing toward red is the only safe
   * direction here -- an operator who sees red checks the cable, an operator
   * who sees a blank panel assumes it is fine.
   */
  const check = useCallback(async () => {
    setChecking(true);
    try {
      const res = await authFetch(HEALTH_ENDPOINT);
      const json = await res.json();
      if (!res.ok) throw json;
      return json.health;
    } catch (error) {
      return {
        state: 'unreachable',
        headline: 'Could not be checked',
        problems: [errText(error, 'The check could not be run from this browser.')],
      };
    } finally {
      setChecking(false);
    }
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
      // After the configuration, never alongside it: the address paints first
      // and the probe fills in behind it.
      const result = await check();
      if (!cancelled) setHealth(result);
    })();
    return () => { cancelled = true; };
  }, [adopt, check, request]);

  /** Re-probe after anything that changes which engine is in force. */
  const recheck = useCallback(async () => {
    setHealth(null);
    setHealth(await check());
  }, [check]);

  async function detect() {
    setBusy(true);
    setErr(null);
    setSaved(null);
    try {
      const json = await request('POST');
      adopt(json.settings);
      setDetected(json.detected);
      if (!json.detected?.found) {
        // Naming only the cable sends a hosted operator to look at hardware that
        // was never in the path: this sweep runs on the server, which on a hosted
        // deployment cannot reach a USB address however well the board is seated.
        setErr(
          'No engine answered any of the addresses above. If SchoolCircle is running on the '
          + 'laptop the Orin is plugged into, check the USB cable is in the device-mode port. '
          + 'If this is the hosted deployment, it cannot reach the USB address at all — enter a '
          + 'tunnel address manually.',
        );
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
      // A saved address is a different engine; the old verdict no longer
      // describes anything.
      await recheck();
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
      await recheck();
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
  // Where the address came from -- a configuration fact, and now clearly
  // labelled as one. It is never the reason the dot is any particular colour.
  const sourceNote = active?.ready
    ? (active.source === 'setting'
      ? 'Address set here in Settings.'
      : 'Address from this deployment’s configuration (DOCTRINE_BASE_URL).')
    : (active?.reason || 'No doctrine engine is configured.');

  return (
    <div className="doctrine-settings">
      <p className="s-settings-p">
        Where grounded answers and citations come from. <strong>Find the Orin</strong> probes from
        the server this app is running on — so it picks the board up over USB, with no key and no
        tunnel, only when SchoolCircle is running on the same laptop the Orin is plugged into.
        <code> http://192.168.55.1:8000</code> is a point-to-point USB address, so a hosted
        deployment cannot route to it: there, give it an address reachable from the server, which
        today means a tunnel pasted in below.
      </p>

      <HealthPanel
        health={health}
        checking={checking}
        sourceNote={sourceNote}
        onRecheck={recheck}
        onEnterAddress={() => setManual(true)}
      />

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
            <code> ops/tunnel.sh</code> is <code>http://localhost:8000</code>. Anything else —
            a quick tunnel, another laptop on the venue network — takes a fresh hostname every
            time it restarts, so paste the current one here and the status light will tell you
            whether it answers.
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
