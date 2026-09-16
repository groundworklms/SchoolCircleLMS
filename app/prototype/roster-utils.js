/* Pure roster helpers. Keep CSV parsing/exporting outside the screen so the
   client can validate an import before making the atomic roster request. */

export const ROSTER_CSV_MAX_ROWS = 500;
export const ROSTER_CSV_MAX_BYTES = 5 * 1024 * 1024;
export const ROSTER_MAX_ENROLLMENTS = 500;
export const REQUIRED_ROSTER_HEADERS = ['name', 'email', 'section'];

export function normalizeRosterEmail(value) {
  return String(value ?? '').trim().toLowerCase();
}

/**
 * Validate a complete add/import operation before anything is persisted.
 * Existing students intentionally include dropped records: an email remains
 * enrolled for the course's lifetime, even after the student is dropped.
 */
export function assertRosterEmailsUnique(existingStudents = [], candidates = []) {
  const seen = new Set();
  existingStudents.forEach((student) => {
    const email = normalizeRosterEmail(student?.email);
    if (email) seen.add(email);
  });
  candidates.forEach((student) => {
    const email = normalizeRosterEmail(student?.email);
    if (!email) return;
    if (seen.has(email)) {
      throw new Error(`Duplicate roster email: ${email}`);
    }
    seen.add(email);
  });
}

export function createRosterMessageRequestId(randomSource = (
  typeof globalThis !== 'undefined' ? globalThis.crypto : null
)) {
  if (!randomSource || typeof randomSource.randomUUID !== 'function') {
    throw new Error('Secure message request IDs are unavailable.');
  }
  return randomSource.randomUUID();
}

function cleanHeader(value) {
  return String(value ?? '').replace(/^\uFEFF/, '').trim().toLowerCase();
}

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      // Quotes are valid at the beginning of a field. Keep permissive parsing
      // for a stray quote in an unquoted value rather than losing a row.
      if (field.length === 0) quoted = true;
      else field += char;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\r' || char === '\n') {
      // CRLF is one record terminator; a quoted newline was handled above.
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      field = '';
      if (row.some((cell) => cell.trim() !== '')) rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }

  if (field.length || row.length) {
    row.push(field);
    if (row.some((cell) => cell.trim() !== '')) rows.push(row);
  }
  if (quoted) throw new Error('CSV contains an unclosed quoted field.');
  return rows;
}

/**
 * Parse a roster CSV. Required columns may be in any order and extra columns
 * are ignored. Values are returned in the API's manual-add shape.
 */
export function parseRosterCsv(text, options = {}) {
  const maxRows = options.maxRows || ROSTER_CSV_MAX_ROWS;
  if (typeof text !== 'string' || !text.trim()) throw new Error('CSV file is empty.');
  const rows = parseCsvRows(text);
  if (!rows.length) throw new Error('CSV file is empty.');

  const headers = rows[0].map(cleanHeader);
  const indexes = Object.fromEntries(headers.map((header, index) => [header, index]));
  const missing = REQUIRED_ROSTER_HEADERS.filter((header) => indexes[header] === undefined);
  if (missing.length) {
    throw new Error(`CSV header must include ${missing.join(', ')}.`);
  }
  if (rows.length - 1 > maxRows) {
    throw new Error(`CSV may contain at most ${maxRows} students.`);
  }

  const students = [];
  rows.slice(1).forEach((row, rowIndex) => {
    const name = String(row[indexes.name] ?? '').trim();
    const email = String(row[indexes.email] ?? '').trim();
    const section = String(row[indexes.section] ?? '').trim();
    if (!name || !email || !section) {
      throw new Error(`CSV row ${rowIndex + 2} needs name, email, and section.`);
    }
    if (!email.includes('@')) {
      throw new Error(`CSV row ${rowIndex + 2} has an invalid email.`);
    }
    students.push({ name, email, section });
  });
  return students;
}

export function escapeSpreadsheetValue(value) {
  const text = String(value ?? '');
  // Prefix formula-like cells before quoting, protecting Excel/Sheets from
  // interpreting imported names or emails as formulas.
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

export function csvCell(value) {
  return `"${escapeSpreadsheetValue(value).replace(/"/g, '""')}"`;
}

export function rosterCsv(students, statusLabel = (status) => status || '') {
  const rows = [
    ['Name', 'Email', 'Section', 'Status', 'Drop reason', 'Effective date'],
    ...students.map((student) => [
      student.name,
      student.email,
      student.section,
      statusLabel(student.status),
      student.dropReason || '',
      student.effectiveDate || student.dropDate || '',
    ]),
  ];
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}
