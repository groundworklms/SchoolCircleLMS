# Data handling

**This repository is public, and so are the twelve arsenal repos.** Anything
committed is world-readable the moment it is pushed, and deleting it later does
not remove it from the git history, from forks, or from anything that already
crawled it.

Read this before your first commit. It is short on purpose.

## Never commit

- Source publications, POIs, curriculum, or courseware obtained through MCeLE,
  EWSDEP, or any other controlled library, in any form: PDF, extracted text,
  chunked JSON, embeddings, or eval sets derived from them. Derived *structure*
  is fine, which is the existing rule in the OG tree. The documents are not.
- Anything marked CUI, FOUO, distribution-restricted, or export-controlled.
- Any learner record, roster, name, EDIPI, DoD ID, email, or other PII. This
  includes seed data: keep the seeded instructor and learner invented.
- Real instructor or student names in fixtures or screenshots.
- Credentials of any kind. `ANTHROPIC_API_KEY`, `MODEL_BASE_URL` credentials,
  `SPEECH_API_KEY`, database URLs, SSH keys. `.env.local` is gitignored, and it
  stays that way.
- Venue network details, CampusNet or MCEN configuration, tunnel endpoints, or
  the Orin's addressing beyond what is already public in the docs.

## Safe to commit

- Code, configuration schemas, thresholds, and the spec stack.
- Publicly releasable doctrine, and only that. The **fourteen** publications in
  the Anchor corpus — all Distribution A, listed in `RANGE-CARD.md` — are the
  reference example. NAVMC 3500.44E is **not** among them and must not become
  one: it is CUI / Distribution Statement C, and that applies to a task count
  derived from it just as much as to the PDF.
- Derived POI structure: annexes, concept cards, hours, lesson IDs, objective
  counts. Not the POI itself.
- Synthetic sample data with invented names, and invented reference tags.

## If controlled material arrives mid-sprint

Do not commit quickly and clean up later.

1. Keep it outside the repo tree entirely, in a sibling directory no repo here
   can reach.
2. Reference it by a path in local configuration, never a committed path.
3. If it must be shared across the four of us, ask an org owner (jeranaias or
   tewhite4) for a private repo. Do not flip a public repo to private, since
   forks and caches of the public version persist.

## If something sensitive gets committed anyway

Speed beats embarrassment. Say so in the team channel immediately. Then, in
order: stop pushing, notify an org owner, rotate anything that was a credential,
and let an owner decide on history rewriting or repo deletion. Do not attempt a
history rewrite yourself while four people are pushing.

## Screenshots, slides, and the projector

The same rules apply to anything on a screen. Check the corner of every
screenshot and the edge of every shared window for a file path, a browser tab, a
terminal scrollback, or a notification that should not be in front of judges.
The planning board renders to a projector by design, so what goes in `PLAN.md`
is public the moment it is displayed.
