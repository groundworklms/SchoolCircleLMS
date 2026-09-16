'use client';

/**
 * Settings -> Generation model.
 *
 * AI generation is the only course-authoring path, so an operator needs to be
 * able to point it at a model without a redeploy: either a self-hosted
 * OpenAI-compatible endpoint (the offline posture, no key needed) or a hosted
 * API of their choice.
 *
 * Two things this panel is careful about:
 *   - It never receives the stored API key, only a masked hint. So "leave blank
 *     to keep" is the real behaviour, not a convenience -- there is nothing to
 *     prefill.
 *   - Saving needs the operator passphrase, because this value decides where
 *     approved source text gets sent. The passphrase is held in component state
 *     for the request and never persisted.
 */

import { useEffect, useState } from 'react';
import { authFetch } from '../../lib/firebase';
import './model-provider.css';

const ENDPOINT = '/api/learning/model-settings';

const PRESETS = [
  {
    id: 'self-hosted',
    label: 'Self-hosted (offline)',
    note: 'A served open-weight model on your own hardware. No API key leaves the network.',
    baseUrl: 'http://127.0.0.1:8001/v1',
    modelId: '',
    needsKey: false,
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    note: 'Hosted API. Requires a key, and source text is sent off the network.',
    baseUrl: 'https://openrouter.ai/api/v1',
    modelId: 'google/gemini-3.1-pro-preview',
    needsKey: true,
  },
  {
    id: 'custom',
    label: 'Other endpoint',
    note: 'Any OpenAI-compatible /chat/completions endpoint.',
    baseUrl: '',
    modelId: '',
    needsKey: false,
  },
];

function errText(error, fallback) {
  return error?.error || error?.message || fallback;
}

function sourceLabel(active) {
  if (!active?.source) return 'Not configured';
  return active.source === 'settings' ? 'From these settings' : 'From deployment environment';
}

export function ModelProviderSettings() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [preset, setPreset] = useState('self-hosted');
  const [baseUrl, setBaseUrl] = useState('');
  const [modelId, setModelId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [clearKey, setClearKey] = useState(false);
  const [passphrase, setPassphrase] = useState('');

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [saved, setSaved] = useState(null);

  function adopt(next) {
    setSettings(next);
    setBaseUrl(next.baseUrl || '');
    setModelId(next.modelId || '');
    setApiKey('');
    setClearKey(false);
    const match = PRESETS.find((p) => p.baseUrl && p.baseUrl === next.baseUrl);
    setPreset(next.baseUrl ? (match?.id || 'custom') : 'self-hosted');
  }

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
  }, []);

  function choosePreset(id) {
    setPreset(id);
    const chosen = PRESETS.find((p) => p.id === id);
    if (!chosen || id === 'custom') return;
    setBaseUrl(chosen.baseUrl);
    if (chosen.modelId) setModelId(chosen.modelId);
  }

  async function send(method, body) {
    setBusy(true);
    setErr(null);
    setSaved(null);
    try {
      const res = await authFetch(ENDPOINT, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'x-model-settings-key': passphrase,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const json = await res.json();
      if (!res.ok) throw json;
      adopt(json.settings);
      setPassphrase('');
      setSaved(method === 'DELETE'
        ? 'Stopped using these settings. Generation falls back to the deployment environment.'
        : 'Saved. New generation requests use this model.');
    } catch (error) {
      setErr(errText(error, 'The generation model could not be saved.'));
    } finally {
      setBusy(false);
    }
  }

  function save(event) {
    event.preventDefault();
    const body = {
      baseUrl: baseUrl.trim(),
      modelId: modelId.trim(),
      // Only send a key when one was typed, or when explicitly clearing it.
      // Omitting the field keeps whatever is stored.
      ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      ...(clearKey && !apiKey.trim() ? { apiKey: null } : {}),
      ...(Number.isInteger(settings?.version) ? { expectedVersion: settings.version } : {}),
    };
    return send('PUT', body);
  }

  if (loading) return <p className="s-settings-p">Loading the generation model…</p>;
  if (loadError) {
    return (
      <p className="s-shell-error" role="alert">
        {errText(loadError, 'Could not load the generation model settings.')}
      </p>
    );
  }

  const active = settings?.active;
  const chosen = PRESETS.find((p) => p.id === preset);
  const locked = !settings?.writable;
  // A hosted provider with no key would save cleanly and then fail on the
  // first generation request, so say so before that happens.
  const keyMissing = Boolean(chosen?.needsKey) && !settings?.hasApiKey && !apiKey.trim();

  return (
    <div className="model-provider">
      <p className="s-settings-p">
        Which model answers generation requests. Course content is only ever generated from
        approved sources; this chooses what does the writing.
      </p>

      <div className="s-settings-row">
        <span>Active now</span>
        <span className="s-settings-val model-provider-active">
          {active?.ready
            ? `${active.model} · ${sourceLabel(active)}`
            : `Unavailable · ${sourceLabel(active)}`}
        </span>
      </div>
      {active && !active.ready && (
        <p className="s-shell-error" role="alert">{active.reason}</p>
      )}
      {settings?.updatedAt && (
        <div className="s-settings-row">
          <span>Last changed</span>
          <span className="s-settings-val">{new Date(settings.updatedAt).toLocaleString()}</span>
        </div>
      )}

      {locked && (
        <p className="s-shell-error" role="alert">{settings?.writableReason}</p>
      )}

      <form className="model-provider-form" onSubmit={save}>
        <label>
          <span>Provider</span>
          <select
            value={preset}
            onChange={(event) => choosePreset(event.target.value)}
            disabled={locked || busy}
          >
            {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
        {chosen?.note && <p className="model-provider-note">{chosen.note}</p>}

        <label>
          <span>Endpoint</span>
          <input
            type="url"
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder="https://host/v1"
            disabled={locked || busy}
            required
          />
        </label>

        <label>
          <span>Model id</span>
          <input
            type="text"
            value={modelId}
            onChange={(event) => setModelId(event.target.value)}
            placeholder="the served model id"
            disabled={locked || busy}
            required
          />
        </label>

        <label>
          <span>
            API key
            {settings?.hasApiKey
              ? ` (${settings.apiKeyHint} in place — leave blank to keep)`
              : ' (leave blank for a self-hosted endpoint)'}
          </span>
          <input
            type="password"
            value={apiKey}
            onChange={(event) => { setApiKey(event.target.value); setClearKey(false); }}
            autoComplete="new-password"
            placeholder={settings?.hasApiKey ? 'Unchanged' : ''}
            disabled={locked || busy || !settings?.secretStorageReady}
          />
        </label>
        {!settings?.secretStorageReady && (
          <p className="model-provider-note">{settings?.secretStorageReason}</p>
        )}
        {settings?.hasApiKey && (
          <label className="model-provider-clear">
            <input
              type="checkbox"
              checked={clearKey}
              onChange={(event) => setClearKey(event.target.checked)}
              disabled={locked || busy || Boolean(apiKey.trim())}
            />
            <span>Remove the stored key (for a self-hosted endpoint)</span>
          </label>
        )}

        <label>
          <span>Operator passphrase</span>
          <input
            type="password"
            value={passphrase}
            onChange={(event) => setPassphrase(event.target.value)}
            autoComplete="off"
            placeholder="Required to change the model"
            disabled={locked || busy}
            required
          />
        </label>

        {keyMissing && (
          <p className="model-provider-note">
            {chosen.label} needs an API key. Saving without one stores the endpoint but leaves
            generation unavailable.
          </p>
        )}
        {err && <p className="s-shell-error" role="alert">{err}</p>}
        {saved && <p className="p-check ok" role="status">{saved}</p>}

        <div className="p-btnrow">
          <button
            type="submit"
            className="p-btn"
            disabled={locked || busy || !baseUrl.trim() || !modelId.trim() || !passphrase}
          >
            {busy ? 'Saving…' : 'Save generation model'}
          </button>
          {settings?.configured && (
            <button
              type="button"
              className="p-btn ghost"
              onClick={() => send('DELETE')}
              disabled={locked || busy || !passphrase}
            >
              Stop using these settings
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

export default ModelProviderSettings;
