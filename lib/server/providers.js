/**
 * Capability registry.
 *
 * Media generation is four different capabilities, not one "AI provider" —
 * they fail independently, they have different on-prem stories, and at the
 * event some will be unavailable. So each resolves its own backend and each
 * degrades on its own without taking the others down.
 *
 * onPrem: how realistic a self-hosted fallback is if the event compute is
 * air-gapped. This is the column that actually matters for planning.
 */

const CAPABILITIES = {
  text: {
    label: 'Text',
    used: 'Study guides, question banks, learning plans, AAR analysis',
    env: ['MODEL_BASE_URL', 'MODEL_ID'],
    onPrem: 'straightforward — any served open-weight LLM',
    critical: true,
  },
  grounding: {
    label: 'Doctrine grounding',
    used: 'Citations, source-checked answers, and refusal when the corpus is silent',
    env: ['DOCTRINE_BASE_URL'],
    // The only row here whose on-prem story is not a plan: this capability is offline by
    // construction. A cloud grounding service would defeat its own purpose at a
    // schoolhouse with no reliable network.
    onPrem: 'already offline - it is the point, not the fallback',
    // Not critical: with DOCTRINE_BASE_URL unset the app behaves exactly as it does
    // today. Marking it critical would add a fifth blocking capability and paint a red
    // required dot on the capabilities screen for something nobody has configured yet.
    critical: false,
  },
  speech: {
    label: 'Speech',
    used: 'Narrated study guides, listen-on-the-move review',
    env: ['SPEECH_API_KEY', 'SPEECH_BASE_URL'],
    onPrem: 'feasible — open TTS models run on modest hardware',
    // The browser can do this with no key and no network at all.
    browserFallback: true,
  },
  image: {
    label: 'Images',
    used: 'Illustrative graphics for lessons',
    env: ['IMAGE_API_KEY', 'IMAGE_BASE_URL'],
    onPrem: 'heavy but possible — diffusion models need a real GPU',
    caution: 'Generated technical diagrams are frequently wrong. Instructor review required.',
  },
  video: {
    label: 'Video',
    used: 'Shared lesson intros (build-time only, never per student)',
    env: ['VIDEO_API_KEY', 'VIDEO_BASE_URL'],
    onPrem: 'not realistic on hackathon timelines',
    caution: 'Minutes per clip and real cost. Build-time only.',
  },
};

export function capabilities() {
  return Object.entries(CAPABILITIES).map(([id, c]) => {
    const via =
      id === 'text'
        ? process.env.MODEL_BASE_URL && process.env.MODEL_ID
          ? 'MODEL_BASE_URL + MODEL_ID'
          : null
        : c.env.find((k) => process.env[k]);
    const ready = Boolean(via) || Boolean(c.browserFallback);
    return {
      id,
      label: c.label,
      used: c.used,
      onPrem: c.onPrem,
      critical: Boolean(c.critical),
      caution: c.caution || null,
      ready,
      via: via ? via : c.browserFallback ? 'browser (no key)' : null,
      env: c.env,
      degraded: !via && Boolean(c.browserFallback),
    };
  });
}

export function textProvider() {
  if (process.env.MODEL_BASE_URL && process.env.MODEL_ID) {
    return {
      provider: 'openai-compatible',
      model: process.env.MODEL_ID,
      baseUrl: process.env.MODEL_BASE_URL,
      ready: true,
    };
  }
  return {
    provider: null,
    ready: false,
    reason:
      'No text model configured. Set MODEL_BASE_URL and MODEL_ID for a self-hosted endpoint.',
  };
}
