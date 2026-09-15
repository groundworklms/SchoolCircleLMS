/**
 * Small, defensive view-model helpers for the evidence panels.
 *
 * The evidence routes intentionally return useful empty and unavailable states
 * instead of inventing measurements. These helpers keep those distinctions
 * intact when an older persistence record or a partial response is rendered.
 */

export function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function asRecords(value) {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

export function errorCode(error) {
  if (!error) return "";
  return String(error.code || error.statusCode || "");
}

export function errorMessage(error, fallback) {
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error.error === "string" && error.error.trim()) return error.error;
  if (error && typeof error.message === "string" && error.message.trim()) return error.message;
  return fallback;
}

export function isExpectedNotFound(error, code) {
  return Boolean(
    error &&
    (errorCode(error) === code ||
      (Number(error.status) === 404 && (!code || errorCode(error) === ""))),
  );
}

export function numberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function stringOrNull(value) {
  return typeof value === "string" && value.trim() ? value : null;
}

/**
 * Preserve the actual Sextant shape while making malformed/partial records
 * safe to iterate over. In particular, a missing phase remains null rather
 * than becoming a zero or a fabricated gain.
 */
export function sextantViewModel(value) {
  const analytics = isRecord(value) ? value : {};
  const gain = isRecord(analytics.gain) ? analytics.gain : null;
  const overall = gain && isRecord(gain.overall) ? gain.overall : null;
  const masteryResult = isRecord(analytics.mastery) ? analytics.mastery : null;

  return {
    scope: stringOrNull(analytics.scope),
    gain,
    overall: overall
      ? {
          prePct: numberOrNull(overall.prePct),
          postPct: numberOrNull(overall.postPct),
          gain: numberOrNull(overall.gain),
          normalizedGain: numberOrNull(overall.normalizedGain),
        }
      : null,
    gaps: asRecords(analytics.gaps),
    mastery: asRecords(analytics.mastery),
    masteryStatus: masteryResult?.status === "insufficient_evidence" ? masteryResult.status : null,
    masteryReason: masteryResult?.status === "insufficient_evidence" ? masteryResult.reason : null,
    evidence: isRecord(analytics.evidence) ? analytics.evidence : {},
    privacy: isRecord(analytics.privacy) ? analytics.privacy : {},
  };
}

/**
 * Understudy's report and run fields are deliberately not flattened into a
 * guessed score. A run can be errored (excluded from the denominator), have
 * no grounding score, or have a valid score of zero.
 */
export function fidelityViewModel(value) {
  const evaluation = isRecord(value) ? value : {};
  const report = isRecord(evaluation.report) ? evaluation.report : null;
  return {
    status: stringOrNull(evaluation.status),
    reason: stringOrNull(evaluation.reason),
    report: report
      ? {
          n: numberOrNull(report.n),
          scored: numberOrNull(report.scored),
          errored: numberOrNull(report.errored),
          conforming: numberOrNull(report.conforming),
          fidelity: numberOrNull(report.fidelity),
          groundedRate: numberOrNull(report.groundedRate),
          meanGrounding: numberOrNull(report.meanGrounding),
          byVerdict: isRecord(report.byVerdict) ? report.byVerdict : {},
          failures: asRecords(report.failures),
        }
      : null,
    runs: asRecords(evaluation.runs),
  };
}

export function studyPlanViewModel(value) {
  const record = isRecord(value) ? value : {};
  const plan = isRecord(record.plan) ? record.plan : null;
  const sourceCoas = plan && isRecord(plan.coas) ? plan.coas : {};
  const keys = ["catch_up", "maintain", "get_ahead"];
  const coas = keys.map((key) => {
    const coa = isRecord(sourceCoas[key]) ? sourceCoas[key] : {};
    return {
      key,
      label: stringOrNull(coa.label) || key.replace("_", " "),
      recommended: coa.recommended === true,
      totalMinutes: numberOrNull(coa.totalMinutes),
      days: numberOrNull(coa.days),
      lateRisk: numberOrNull(coa.lateRisk),
      blocks: asRecords(coa.blocks),
    };
  });
  return {
    record,
    plan,
    coas,
    selectedBlocks: asRecords(record.selectedBlocks),
    reminders: asRecords(record.reminders),
  };
}

export function cohortProfileViewModel(value) {
  const profile = isRecord(value) ? value : {};
  return {
    status: stringOrNull(profile.status),
    reason: stringOrNull(profile.reason),
    n: numberOrNull(profile.n),
    dims: isRecord(profile.dims) ? profile.dims : {},
    modalityMix: asRecords(profile.modalityMix),
    recommendations: Array.isArray(profile.recommendations)
      ? profile.recommendations.filter((item) => typeof item === "string")
      : [],
    privacy: isRecord(profile.privacy) ? profile.privacy : {},
  };
}
