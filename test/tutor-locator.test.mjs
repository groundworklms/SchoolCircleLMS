import assert from "node:assert/strict";
import test from "node:test";
import {
  exactSourcePassages,
  resolveTutorCitationLocator,
  sourceIdentityMatches,
} from "../app/_learning/tutor-locator.mjs";

test("resolves the real tutor locator while keeping the human label separate", () => {
  const locator = resolveTutorCitationLocator({
    source: "record-id p.1",
    sourceId: "TC 3-22.9",
    page: null,
  });
  assert.deepEqual(
    locator,
    {
      source: "record-id p.1",
      sourceLabel: "TC 3-22.9",
      recordId: "record-id",
      sourceId: "TC 3-22.9",
      page: 1,
      unavailableReason: null,
    },
  );
  assert.equal(sourceIdentityMatches({ id: "record-id" }, locator), true);
  assert.equal(sourceIdentityMatches({ id: "TC 3-22.9" }, locator), false);
});

test("supports a direct source record id only when page is explicit", () => {
  assert.deepEqual(
    resolveTutorCitationLocator({
      source: "record-id",
      sourceId: "Human source label",
      page: 3,
    }),
    {
      source: "record-id",
      sourceLabel: "Human source label",
      recordId: "record-id",
      sourceId: "Human source label",
      page: 3,
      unavailableReason: null,
    },
  );

  assert.match(
    resolveTutorCitationLocator({
      source: "record-id",
      sourceId: "Human source label",
    }).unavailableReason,
    /page is required/,
  );
});

test("rejects missing, malformed, and conflicting locators without fallback", () => {
  const invalidCitations = [
    {
      citation: { sourceId: "Human source label", page: 1 },
      reason: /no source record locator/,
    },
    {
      citation: { source: "record-id p.not-a-page", sourceId: "Human source label" },
      reason: /source locator is malformed/,
    },
    {
      citation: { source: "record-id p.1", sourceId: "Human source label", page: 2 },
      reason: /conflicts/,
    },
    {
      citation: { source: "record-id", sourceId: "Human source label", page: "not-a-page" },
      reason: /citation page is malformed/,
    },
  ];

  for (const { citation, reason } of invalidCitations) {
    const locator = resolveTutorCitationLocator(citation);
    assert.equal(locator.recordId, null);
    assert.equal(locator.page, null);
    assert.match(locator.unavailableReason, reason);
  }
});

test("matches only the cited page and never substitutes another page", () => {
  const sourceData = {
    id: "record-id",
    status: "APPROVED",
    pages: [
      { page: 1, text: "Exact page one passage." },
      { page: 3, text: "Exact page three passage." },
    ],
    text: "A full document fallback must not be used.",
  };

  assert.deepEqual(exactSourcePassages(sourceData, 1), ["Exact page one passage."]);
  assert.deepEqual(exactSourcePassages(sourceData, 2), []);
});