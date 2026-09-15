/**
 * Resolve the citation locator emitted by the learning tutor.
 *
 * Tutor passages use `source` as the authenticated record locator
 * (`${record.id} p.${page}`), while `sourceId` is only the human-readable
 * source label. Some persisted learning surfaces provide the record id
 * directly and carry the page separately.
 */

export function nonEmptyString(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  return value.trim();
}

export function pageNumber(value) {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

export function resolveTutorCitationLocator(citation) {
  const source = nonEmptyString(citation?.source);
  const sourceLabel = nonEmptyString(citation?.sourceId);
  const hasExplicitPage = citation?.page !== undefined && citation?.page !== null;
  const explicitPage = pageNumber(citation?.page);

  if (!source) {
    return {
      source: "Source locator unavailable",
      sourceLabel,
      recordId: null,
      sourceId: sourceLabel,
      page: null,
      unavailableReason: "Locator unavailable: the citation has no source record locator.",
    };
  }
  if (hasExplicitPage && explicitPage === null) {
    return {
      source,
      sourceLabel,
      recordId: null,
      sourceId: sourceLabel,
      page: null,
      unavailableReason: "Locator unavailable: the citation page is malformed.",
    };
  }

  const locatorMatch = source.match(/^(.+?)\s+p\.(\d+)$/);
  const containsLocatorMarker = source.includes(" p.");
  if (containsLocatorMarker && !locatorMatch) {
    return {
      source,
      sourceLabel,
      recordId: null,
      sourceId: sourceLabel,
      page: null,
      unavailableReason: "Locator unavailable: the source locator is malformed.",
    };
  }

  const recordId = locatorMatch?.[1].trim() || source;
  const locatorPage = locatorMatch ? pageNumber(locatorMatch[2]) : null;
  if (locatorMatch && recordId.includes(" p.")) {
    return {
      source,
      sourceLabel,
      recordId: null,
      sourceId: sourceLabel,
      page: null,
      unavailableReason: "Locator unavailable: the source locator is malformed.",
    };
  }
  if (locatorMatch && locatorPage === null) {
    return {
      source,
      sourceLabel,
      recordId: null,
      sourceId: sourceLabel,
      page: null,
      unavailableReason: "Locator unavailable: the source locator page is malformed.",
    };
  }
  if (locatorMatch && hasExplicitPage && explicitPage !== locatorPage) {
    return {
      source,
      sourceLabel,
      recordId: null,
      sourceId: sourceLabel,
      page: null,
      unavailableReason:
        "Locator unavailable: the citation page conflicts with its source locator.",
    };
  }
  if (!locatorMatch && !hasExplicitPage) {
    return {
      source,
      sourceLabel,
      recordId: null,
      sourceId: sourceLabel,
      page: null,
      unavailableReason:
        "Locator unavailable: a page is required for this source record.",
    };
  }

  return {
    source,
    sourceLabel,
    recordId,
    sourceId: sourceLabel,
    page: locatorPage ?? explicitPage,
    unavailableReason: null,
  };
}

export function sourceIdentityMatches(sourceData, locator) {
  return Boolean(locator?.recordId) && sourceData?.id === locator.recordId;
}

export function exactSourcePassages(sourceData, page) {
  const pageText = (Array.isArray(sourceData?.pages) ? sourceData.pages : [])
    .filter((sourcePage) => pageNumber(sourcePage?.page) === page)
    .map((sourcePage) => nonEmptyString(sourcePage?.text))
    .filter((text) => Boolean(text));
  if (pageText.length > 0) return pageText;

  return (Array.isArray(sourceData?.chunks) ? sourceData.chunks : [])
    .filter((sourcePage) => pageNumber(sourcePage?.page) === page)
    .map((sourcePage) => nonEmptyString(sourcePage?.text))
    .filter((text) => Boolean(text));
}