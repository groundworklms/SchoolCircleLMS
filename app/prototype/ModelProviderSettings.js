'use client';

/**
 * Settings -> Generation model.
 *
 * AI generation is the only course-authoring path, so an instructor needs to be
 * able to choose what does the writing. Instructors are not administrators, so
 * the default view is a list of models the endpoint actually serves and one
 * button -- no URLs, no keys, no jargon.
 *
 * The split that makes that safe: picking a model on the endpoint the
 * deployment already configured cannot send course material anywhere new, so it
 * is an ordinary instructor action. Changing the endpoint or supplying an API
 * key can, so those live behind "Advanced" and require the operator passphrase.
 * The server enforces this independently (changeNeedsOperator); the UI only
 * reflects it.
 *
 * The panel never receives a stored API key, only a masked hint -- so "leave
 * blank to keep" is the real behaviour, not a convenience.
 */

import { useCallback, useEffect, useState } from 'react';
import { authFetch } from '../../lib/firebase';
import './model-provider.css';

const ENDPOINT = '/api/learning/model-settings';
const MODELS_ENDPOINT = '/api/learning/model-settings/models';

function errText(error, fallback) {
  return error?.error || error?.message || fallback;
}

/**
 * One-line plain-language hint for the families an instructor is likely to see.
 * Keyed on substrings of ids the endpoint reported, so an unfamiliar model gets
 * no hint rather than a wrong one.
 */
const TIER_HINTS = {
  flagship: 'Newest full-size model. Best writing quality.',
  mini: 'Quick and inexpensive. A sensible default.',
  nano: 'Fastest and cheapest. Fine for rough drafts.',
  pro: 'Most capable, slowest and priciest. For difficult material.',
};

function hintFor(model) {
  if (model.tier && TIER_HINTS[model.tier]) return TIER_HINTS[model.tier];
  const name = model.id.toLowerCase();
  if (name.includes('nano')) return 'Fastest and cheapest. Fine for rough drafts.';
  if (name.includes('mini')) return 'Quick and inexpensive. A sensible default.';
  if (/^o[1-9]/.test(name)) return 'Slower, stronger at hard reasoning.';
  if (name.includes('turbo')) return 'Older generation, still capable.';
  return 'Full-size model. Best writing, higher cost.';
}

export function ModelProviderSettings() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [models, setModels] = useState(null);
  const [recommended, setRecommended] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const [modelsError, setModelsError] = useState(null);
  const [chosen, setChosen] = useState('');

  const [advanced, setAdvanced] = useState(false);
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [claim, setClaim] = useState('');
  const [claimConfirm, setClaimConfirm] = useState('');

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [saved, setSaved] = useState(null);
  const [probe, setProbe] = useState(null);

  const adopt = useCallback((next) => {
    setSettings(next);
    setBaseUrl(next.baseUrl || next.active?.baseUrl || '');
    setChosen(next.modelId || next.active?.model || '');
    setApiKey('');
    setClaim('');
    setClaimConfirm('');
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch(ENDPOINT);
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) throw json;
        adopt(json.settings);
      } catch (error) {
        if (!cancelled) setLoadError(error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [adopt]);

  // Load the picker's options as soon as the panel opens. Reading the
  // configured endpoint's catalogue needs no passphrase, so an instructor sees
  // choices immediately instead of having to ask for them.
  useEffect(() => {
    if (loading || loadError) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch(MODELS_ENDPOINT);
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) throw json;
        setModels(json.models || []);
        setRecommended(json.recommended?.length ? json.recommended : null);
        setModelsError(null);
      } catch (error) {
        if (!cancelled) {
          setModels(null);
          setModelsError(errText(error, 'The list of models could not be loaded.'));
        }
      }
    })();
    return () => { cancelled = true; };
  }, [loading, loadError]);

  async function request(method, body, { withPassphrase = false, url = ENDPOINT } = {}) {
    const res = await authFetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(withPassphrase ? { 'x-model-settings-key': passphrase } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const json = await res.json();
    if (!res.ok) throw json;
    return json;
  }

  /** The simple path: use the chosen model on the endpoint already in force. */
  async function useModel(event) {
    event.preventDefault();
    setBusy(true);
    setErr(null);
    setSaved(null);
    setProbe(null);
    try {
      const json = await request('PUT', {
        modelId: chosen,
        ...(Number.isInteger(settings?.version) ? { expectedVersion: settings.version } : {}),
      });
      adopt(json.settings);
      setSaved('Saved. New course generation uses this model.');
    } catch (error) {
      setErr(errText(error, 'That model could not be selected.'));
    } finally {
      setBusy(false);
    }
  }

  /** Advanced: change the endpoint and/or supply a key. Needs the passphrase. */
  async function saveAdvanced(event) {
    event.preventDefault();
    setBusy(true);
    setErr(null);
    setSaved(null);
    setProbe(null);
    try {
      const json = await request('PUT', {
        baseUrl: baseUrl.trim(),
        modelId: chosen,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        ...(Number.isInteger(settings?.version) ? { expectedVersion: settings.version } : {}),
      }, { withPassphrase: true });
      adopt(json.settings);
      setPassphrase('');
      setSaved('Saved. New course generation uses this endpoint and model.');
      // The catalogue belongs to the old endpoint; make the panel re-ask.
      setModels(null);
      setModelsError(null);
    } catch (error) {
      setErr(errText(error, 'Those settings could not be saved.'));
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setErr(null);
    setProbe(null);
    try {
      const json = await request('POST', { modelId: chosen }, { url: MODELS_ENDPOINT });
      setProbe(`${json.model} answered. The connection works.`);
    } catch (error) {
      setErr(errText(error, 'The model did not answer.'));
    } finally {
      setBusy(false);
    }
  }

  async function revert() {
    setBusy(true);
    setErr(null);
    setSaved(null);
    try {
      const json = await request('DELETE', null, { withPassphrase: true });
      adopt(json.settings);
      setPassphrase('');
      setSaved('Reverted to the model this deployment is configured with.');
    } catch (error) {
      setErr(errText(error, 'That could not be reverted.'));
    } finally {
      setBusy(false);
    }
  }

  async function claimPassphrase(event) {
    event.preventDefault();
    if (claim !== claimConfirm) {
      setErr('Those two passphrases do not match.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const json = await request('POST', { passphrase: claim });
      adopt(json.settings);
      setSaved('Operator passphrase set.');
    } catch (error) {
      setErr(errText(error, 'The operator passphrase could not be set.'));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="s-settings-p">Loading…</p>;
  if (loadError) {
    return (
      <p className="s-shell-error" role="alert">
        {errText(loadError, 'Could not load the generation model settings.')}
      </p>
    );
  }

  const active = settings?.active;
  const activeModel = active?.ready ? active.model : null;
  const changed = Boolean(chosen) && chosen !== activeModel;

  return (
    <div className="model-provider">
      <p className="s-settings-p">
        Which AI writes your course drafts. Content is only ever generated from sources you have
        approved — this chooses what does the writing.
      </p>

      <div className="s-settings-row">
        <span>Currently using</span>
        <span className="s-settings-val model-provider-active">
          {activeModel || 'No model chosen yet'}
        </span>
      </div>
      {active && !active.ready && active.reason && (
        <p className="s-shell-error" role="alert">{active.reason}</p>
      )}

      {/* The whole simple path: pick one, press one button. */}
      <form className="model-provider-form" onSubmit={useModel}>
        {(() => {
          if (!models || models.length === 0) return null;
          // A real catalogue runs to dozens of near-identical ids, which is not
          // a choice an instructor should have to make. Show the curated few
          // and keep the rest one click away.
          const shortlist = recommended && !showAll ? recommended : models;
          const chosenIsHidden = chosen && !shortlist.some((m) => m.id === chosen);
          const listed = chosenIsHidden
            ? [...shortlist, models.find((m) => m.id === chosen) || { id: chosen, label: chosen }]
            : shortlist;
          return (
            <>
              <div className="model-provider-choices" role="radiogroup" aria-label="Available models">
                {listed.map((model) => (
                  <label key={model.id} className="model-provider-choice">
                    <input
                      type="radio"
                      name="model-choice"
                      value={model.id}
                      checked={chosen === model.id}
                      onChange={() => { setChosen(model.id); setProbe(null); }}
                      disabled={busy}
                    />
                    <span className="model-provider-choice-body">
                      <span className="model-provider-choice-name">{model.label}</span>
                      <span className="model-provider-choice-hint">{hintFor(model)}</span>
                    </span>
                  </label>
                ))}
              </div>
              {recommended && models.length > recommended.length && (
                <button
                  type="button"
                  className="model-provider-disclose"
                  onClick={() => setShowAll((open) => !open)}
                  aria-expanded={showAll}
                >
                  {showAll
                    ? 'Show fewer models'
                    : `Show all ${models.length} available models`}
                </button>
              )}
            </>
          );
        })()}

        {models && models.length === 0 && (
          <p className="model-provider-note">
            The endpoint reported no usable models. Check the API key in Advanced settings.
          </p>
        )}

        {/* No catalogue: say why, and still allow a typed id rather than dead-ending. */}
        {modelsError && (
          <>
            <p className="model-provider-note">{modelsError}</p>
            <label>
              <span>Model name</span>
              <input
                type="text"
                value={chosen}
                onChange={(event) => setChosen(event.target.value)}
                placeholder="a model your endpoint serves"
                disabled={busy}
              />
            </label>
          </>
        )}
        {!models && !modelsError && <p className="model-provider-note">Loading available models…</p>}

        {err && <p className="s-shell-error" role="alert">{err}</p>}
        {saved && <p className="p-check ok" role="status">{saved}</p>}
        {probe && <p className="p-check ok" role="status">{probe}</p>}

        <div className="p-btnrow">
          <button type="submit" className="p-btn" disabled={busy || !chosen || !changed}>
            {busy ? 'Saving…' : 'Use this model'}
          </button>
          <button type="button" className="p-btn ghost" onClick={test} disabled={busy || !chosen}>
            Test it
          </button>
        </div>
      </form>

      <button
        type="button"
        className="model-provider-disclose"
        onClick={() => setAdvanced((open) => !open)}
        aria-expanded={advanced}
      >
        {advanced ? 'Hide advanced settings' : 'Advanced settings'}
      </button>

      {advanced && (settings?.needsPassphraseClaim ? (
        <form className="model-provider-form" onSubmit={claimPassphrase}>
          <p className="model-provider-note">
            Changing the endpoint or entering an API key needs an operator passphrase, and none is
            set for this deployment yet. Choosing a model above does not need one.
          </p>
          <label>
            <span>New operator passphrase</span>
            <input
              type="password"
              value={claim}
              onChange={(event) => setClaim(event.target.value)}
              autoComplete="new-password"
              minLength={8}
              placeholder="At least 8 characters"
              disabled={busy}
              required
            />
          </label>
          <label>
            <span>Confirm passphrase</span>
            <input
              type="password"
              value={claimConfirm}
              onChange={(event) => setClaimConfirm(event.target.value)}
              autoComplete="new-password"
              disabled={busy}
              required
            />
          </label>
          <div className="p-btnrow">
            <button
              type="submit"
              className="p-btn"
              disabled={busy || claim.length < 8 || claim !== claimConfirm}
            >
              Set operator passphrase
            </button>
          </div>
          <p className="model-provider-note">
            It cannot be reset from here afterwards — that is a configuration change
            (MODEL_SETTINGS_KEY) — so keep a copy.
          </p>
        </form>
      ) : (
        <form className="model-provider-form" onSubmit={saveAdvanced}>
          <label>
            <span>Endpoint</span>
            <input
              type="url"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="https://host/v1"
              disabled={busy}
              required
            />
          </label>
          <p className="model-provider-note">
            Any OpenAI-compatible endpoint, including a model served on your own network.
          </p>

          <label>
            <span>
              API key
              {settings?.hasApiKey
                ? ` (${settings.apiKeyHint} stored — leave blank to keep)`
                : ' (leave blank to keep using the deployment key)'}
            </span>
            <input
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              autoComplete="new-password"
              disabled={busy || !settings?.secretStorageReady}
            />
          </label>
          {active?.credential === 'environment' && (
            <p className="model-provider-note">
              Using the API key from this deployment&apos;s configuration, so nothing needs to be
              entered here.
            </p>
          )}
          {!settings?.secretStorageReady && active?.credential !== 'environment' && (
            <p className="model-provider-note">{settings?.secretStorageReason}</p>
          )}

          <label>
            <span>Operator passphrase</span>
            <input
              type="password"
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
              autoComplete="off"
              disabled={busy}
              required
            />
          </label>
          {settings?.passphrasePinned && (
            <p className="model-provider-note">
              Pinned by this deployment&apos;s MODEL_SETTINGS_KEY.
            </p>
          )}

          <div className="p-btnrow">
            <button
              type="submit"
              className="p-btn"
              disabled={busy || !baseUrl.trim() || !chosen || !passphrase}
            >
              Save endpoint and model
            </button>
            {settings?.configured && (
              <button
                type="button"
                className="p-btn ghost"
                onClick={revert}
                disabled={busy || !passphrase}
              >
                Revert to deployment default
              </button>
            )}
          </div>
        </form>
      ))}
    </div>
  );
}

export default ModelProviderSettings;
