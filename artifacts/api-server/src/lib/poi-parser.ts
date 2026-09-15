// @ts-nocheck
/**
 * MCCES POI parser — coordinate-aware, course-agnostic.
 *
 * Ported from the Python prototype. Naive text extraction scrambles these
 * documents (header fields overlay objective text), so we rebuild reading
 * order from glyph positions: group words into y-bands, sort each band by x.
 *
 * Validated against two real POIs from different schools:
 *   Basic Electronics (M092721, 28xx) and Network Administrator (M09CVS1, 06xx).
 */

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const LESSON_ID = String.raw`[A-Z]{2,5}\.\d{2}\.\d{2}`;
const LO_CODE = String.raw`[0-9A-Z]{4}-[A-Z]+-\d+[a-z]*`;
const DESC = /During this annex|This annex|The administrative annex/;

/** Rebuild a page's lines from word positions. */
function pageLines(textContent) {
  const bands = new Map();
  for (const item of textContent.items) {
    if (!item.str || !item.str.trim()) continue;
    const x = item.transform[4];
    const y = item.transform[5];
    const key = Math.round(y / 4); // 4pt bands, same as the Python version
    if (!bands.has(key)) bands.set(key, []);
    bands.get(key).push([x, item.str]);
  }
  // PDF y grows upward, so descending y is top-to-bottom
  return [...bands.keys()]
    .sort((a, b) => b - a)
    .map((k) =>
      bands
        .get(k)
        .sort((p, q) => p[0] - q[0])
        .map((p) => p[1])
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
    );
}

export async function parsePoi(data) {
  const doc = await getDocument({ data, useSystemFonts: true }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const pg = await doc.getPage(i);
    pages.push(pageLines(await pg.getTextContent()));
  }
  const flat = pages.flat();

  /* ---------- course metadata ---------- */
  const meta = { sourcePages: doc.numPages };
  const grab = (re, key) => {
    if (meta[key]) return;
    for (const l of flat) {
      const m = l.match(re);
      if (m) {
        meta[key] = m[1].trim();
        return;
      }
    }
  };
  grab(/1\.\s*COURSE TITLE:\s*(.+)/, 'courseTitle');
  grab(/3\.\s*COURSE ID:\s*(\S+)/, 'courseId');
  grab(/6\.\s*OUTCOME:\s*(.+)/, 'outcome');
  grab(/8\.\s*LENGTH \(PEACETIME\):\s*(.+)/, 'length');
  for (const l of flat) {
    const m = l.match(/v\s*([\d.]+|\d{4})\s*-\s*(APPROVED|HISTORICAL|DRAFT)/);
    if (m) {
      meta.version = m[1];
      meta.status = m[2];
      break;
    }
  }

  /* ---------- Section III: scope of annexes ---------- */
  const annexTitles = new Map();
  for (const pg of pages) {
    if (!pg.some((l) => l.includes('SCOPE OF ANNEXES'))) continue;
    pg.forEach((raw, i) => {
      const m = raw.trim().match(/^([A-Z])\.\s*(.*)$/);
      if (!m) return;
      const [, letter, rest] = m;
      let title = rest.split(DESC)[0].trim();
      let described = DESC.test(rest);
      if (!title && i + 1 < pg.length) {
        // letter sat alone on its line; the title leads the next one
        const next = pg[i + 1].trim();
        title = next.split(DESC)[0].trim();
        described = DESC.test(next);
      }
      if (title && described && !annexTitles.has(letter)) annexTitles.set(letter, title);
    });
  }

  /* ---------- Section IV: LO cross-reference ---------- */
  const lessons = new Map();
  const loMap = new Map();
  const rowRe = new RegExp(`^(?:(${LO_CODE})\\s+)?([A-Z])\\s+(${LESSON_ID})\\s+(.+)$`);
  let currentLo = null;
  for (const pg of pages) {
    if (!pg.some((l) => l.includes('LOCATION OF LEARNING OBJECTIVES'))) continue;
    for (const l of pg) {
      const m = l.trim().match(rowRe);
      if (!m) continue;
      const [, lo, annex, id, title] = m;
      if (lo) currentLo = lo;
      if (currentLo) {
        if (!loMap.has(currentLo)) loMap.set(currentLo, new Set());
        loMap.get(currentLo).add(id);
      }
      if (!lessons.has(id)) lessons.set(id, { annex, title: title.trim() });
    }
  }

  /* ---------- concept cards: hours, type, annex from page header ---------- */
  const idRe = new RegExp(`LESSON ID:\\s*(${LESSON_ID})`);
  let cur = null;
  for (const pg of pages) {
    let hdr = null;
    for (const l of pg) {
      const m = l.match(/ANNEX\s+([A-Z])\s*[-–]\s*\S/);
      if (m) {
        hdr = m[1];
        break;
      }
    }
    for (const l of pg) {
      const m = l.match(idRe);
      if (m) {
        cur = m[1];
        if (!lessons.has(cur)) lessons.set(cur, { annex: '?', title: '(untitled)' });
        if (lessons.get(cur).annex === '?' && hdr) lessons.get(cur).annex = hdr;
      }
      if (!cur) continue;
      const rec = lessons.get(cur);
      const h = l.match(/HOURS:\s*([\d.]+)/);
      if (h && rec.hours === undefined) rec.hours = parseFloat(h[1]);
      const t = l.match(/TYPE:\s*(Task Oriented|Lesson Purpose|Exam)/);
      if (t && !rec.type) rec.type = t[1];
      const ti = l.match(/TITLE:\s*(.+?)(?:\s+PHASE:|\s*$)/);
      if (ti && rec.title === '(untitled)') rec.title = ti[1].trim();
    }
  }

  /* ---------- assemble ---------- */
  const annexes = [...annexTitles.keys()].sort().map((letter) => {
    const ls = [...lessons.entries()]
      .filter(([, v]) => v.annex === letter)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, v]) => ({
        id,
        title: v.title,
        hours: v.hours ?? 0,
        kind: /exam/i.test(v.title) ? 'exam' : 'lesson',
      }));
    return {
      letter,
      title: annexTitles.get(letter),
      lessons: ls,
      hours: round2(ls.reduce((s, l) => s + l.hours, 0)),
    };
  });

  const unplaced = [...lessons.entries()].filter(([, v]) => v.annex === '?').map(([k]) => k);

  // Section II declares academic hours — an independent check on the parse.
  let statedAcademic = null;
  for (const l of flat) {
    const m = l.match(/^Academic\s+([\d.]+)$/);
    if (m) {
      statedAcademic = parseFloat(m[1]);
      break;
    }
  }
  const academic = round2(
    annexes.filter((a) => a.letter !== 'Z').reduce((s, a) => s + a.hours, 0)
  );

  return {
    ...meta,
    annexes,
    totalLessons: annexes.reduce((s, a) => s + a.lessons.length, 0),
    totalHours: round2(annexes.reduce((s, a) => s + a.hours, 0)),
    totalObjectives: loMap.size,
    unplaced,
    reconciliation: {
      academicParsed: academic,
      academicStated: statedAcademic,
      ok: statedAcademic !== null && Math.abs(statedAcademic - academic) < 0.5,
    },
  };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
