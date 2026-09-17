/*
 * The provenance helpers, re-exported for the client tree.
 *
 * The definition moved to lib/provenance.js because the SCORM export needs the
 * same line the screens show, and a server/export path must not reach up into
 * app/ for it: everything under app/_course is part of the App Router client
 * tree (its sibling CoursePresentation.js is a 'use client' React component),
 * and lib/ importing from there would drag that tree into the module graph of
 * every route that builds a package. Mirroring the functions instead would have
 * left two definitions of "how a citation reads", which is how the export came
 * to print a primary key while every screen printed a publication.
 *
 * Six client modules import from '../_course/provenance', so this stays as the
 * name they know; there is one implementation behind it.
 */
export { pageOf, provenanceOf, publicationName, withoutPage } from '../../lib/provenance.js';
