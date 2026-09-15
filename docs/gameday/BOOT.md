# BOOT — stand the demo up on fresh machines, fast

Every laptop on gameday is a clean slate: nothing installed, nothing cloned, no keys, no USB
sticks. This file makes that a non-issue. Each person opens a terminal, runs `claude`, and pastes
**their** block below — the instance provisions the machine and brings its lane up. Do the work,
report status, stop before pushing.

## The only human step (nothing else is manual)
**Plug the Orin into the lead laptop** — USB device-mode cable + the Orin's power. That point-to-
point link is the whole offline story; it appears as network `192.168.55.1`.

SSH is already password-free: a dedicated gameday key is pre-registered on the Orin. The **private**
half lives on the lead laptop at `~/.ssh/gameday_orin` (never committed); the **public** half is in
[`keys/gameday_orin.pub`](keys/gameday_orin.pub) for the record. See [`keys/README.md`](keys/README.md)
to put the key on a fresh laptop, and to revoke it after the event. No password and no private key
ever appear in this repo.

## Topology (read once so Tuesday isn't confusing)
- **Anchor** (the grounding engine) runs **on the Orin**, not on any laptop.
- Only the **lead laptop** is physically wired to the Orin (`192.168.55.1` is point-to-point USB —
  other laptops cannot see it).
- So **the demo machine = the lead laptop**: it runs the SSH tunnel *and* hosts the LMS, which calls
  Anchor at `http://localhost:8000`.
- **Other laptops** (White, McDonald) develop against a mock or against a URL the lead laptop shares
  over the venue network — they don't need the Orin to build screens and logic.

---

## 1 — LEAD / OPS laptop (Morgan — the one wired to the Orin)

```
You're my ops pair for a Marine Corps hackathon demo, on a FRESH machine — assume nothing is
installed or cloned, and there is no USB stick and no SSH key file. I'm Morgan (Jesse). Do the
work yourself; report one-line PASS/FAIL per step; STOP on any failure. Don't hand me commands.

Ground truth:
- The grounding engine "Anchor" runs on a Jetson Orin plugged into this laptop over USB
  device-mode at 192.168.55.1, user "vanguard". A pre-registered key handles auth — use
  `ssh -i ~/.ssh/gameday_orin vanguard@192.168.55.1`. No password. If that key file is missing on
  this laptop, STOP and tell me (docs/gameday/keys/README.md says how to place it).
- Anchor serves /api/ask on the Orin's port 8000; we tunnel it to this laptop's localhost:8000.

Steps:
1. Ensure Git, Node 18+, and Claude Code are installed (install what's missing, Windows).
2. Reach the Orin: `ssh -i ~/.ssh/gameday_orin vanguard@192.168.55.1 uptime`. Confirm it works.
3. Confirm all 5 services are active:
   ssh -i ~/.ssh/gameday_orin vanguard@192.168.55.1 'systemctl is-active tutor-api tutor-gen tutor-embed tutor-rerank tutor-verify'
4. Open a background tunnel and KEEP it alive — auto-reconnect if it drops, without asking me:
   ssh -i ~/.ssh/gameday_orin -N -L 8000:127.0.0.1:8000 vanguard@192.168.55.1
5. Smoke-test cite-or-refuse against http://localhost:8000/api/ask :
   - "What is trigger control?"  -> expect citations, abstained:false
   - "What is the max range of a Javelin?"  -> expect abstained:true, low_retrieval_score
   Show me the key fields from each.
Then a 3-line readiness summary: engine / tunnel / grounding. Nothing more.
```

## 2 — APP HOST laptop (White — runs the LMS)

```
You're my pair on a FRESH machine. I'm White, backend/app-host lead for a grounded Marine Corps
training platform (SchoolCircleLMS). Do the work; report status; stop before any git push.

1. Ensure Git, Node 18+, and Claude Code are installed (install what's missing, Windows).
2. Clone and read the spec:
   git clone https://github.com/groundworklms/SchoolCircleLMS   (if that 404s, use
   https://github.com/jeranaias/grounded-training-demo and read its docs/ folder).
   Read docs/gameday/RANGE-CARD.md, docs/gameday/COLD-BORE.md, then docs/03-data-model.md,
   docs/02-architecture.md, docs/05-arsenal-contracts.md.
3. Install deps, migrate the Prisma schema, seed ONE TC 3-22.9 course + one instructor + one
   learner. Show me the seed result.
4. Point the app at Anchor via DOCTRINE_BASE_URL. On the demo machine that's http://localhost:8000
   (Morgan's tunnel). On my own laptop I can't see the Orin, so use a mock/stub for /api/ask while
   I build, and we integrate against the real tunnel on the demo machine. Confirm the app starts.
5. Start the dev server; tell me the URL. Rule that never bends: nothing with status PENDING is
   ever served to a learner.
```

## 3 — FRONTEND laptop (McDonald — new to development)

```
I'm McDonald and I'm brand new — never coded, never used GitHub. Be my patient guide: explain
every command in plain words BEFORE running it, keep steps tiny, never assume I know a term. Fresh
Windows laptop; we're building the frontend of a Marine Corps training platform.

1. Check for Node and Git (`node --version`, `git --version`). If either is missing, walk me
   through installing it one click at a time.
2. Clone the project and open the design guide:
   git clone https://github.com/jeranaias/grounded-training-demo
   Read docs/01-design-system.md and summarize it for me in plain English — that file is how
   everything should look.
3. Open the live target in a browser: https://jeranaias.github.io/grounded-training-demo/app.html
   and describe what I'm looking at.
4. Give me ONE small, safe first task — a single component or screen from the design system — and
   build it with me, one piece at a time. Don't push to GitHub without walking me through it first.
```

## 4 — QA laptop (Thompson — no code)

```
I'm Thompson, QA and product voice — I test this like a Marine would use it. No coding.
1. Open the live showcase in a browser: https://jeranaias.github.io/grounded-training-demo (the
   landing) and .../app.html (the full instructor + student app).
2. Read docs/gameday/RANGE-CARD.md (the 5-minute demo) and docs/06-learner-loop.md +
   docs/07-instructor-loop.md so you know what "correct" looks like; then list things to try to
   break, as a student AND as an instructor.
3. For every bug or idea, I use the QA widget (bottom-left button in the app) — it opens a
   prefilled GitHub issue. Help me word each one: what I did, expected, what happened, how bad it
   is. Then help me rank the board and shape what makes a judge say "wow."
```

---

**Guardrail in every lane:** grounded, verified, offline, human-led. Nothing ungrounded and
nothing `PENDING` ever reaches a learner. Each prompt stops before pushing — you stay in control.
