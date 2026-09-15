// Sample course, single source of truth in lib/sample.json so both the app (ESM) and
// prisma/seed.js (CommonJS) read the same data.
//
// Used two ways:
//   1. by prisma/seed.js as the seed content, and
//   2. as the "sample mode" fallback in pages when the database isn't set up yet, so
//      `npm run dev` shows something real before `db:migrate && db:seed`.
//
// Item.citation shape: { citation, pubId, section, para, page }.
import sampleCourse from "./sample.json";

export { sampleCourse };
