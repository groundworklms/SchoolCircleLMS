# 01 · Design System — SchoolCircle house style

The single source of truth for how SchoolCircleLMS looks. A fresh build that follows this file
lands on White's design without guessing. The look is **Apple-glass on Marine scarlet**: one accent,
borderless cards on a hairline + soft shadow, 18px corners, the system SF font, light-committed.

Scope everything under a root class (`.p-root` on the app shell, or `:root` for a single-purpose page)
so tokens cascade. Student surfaces use `s-*` classes; instructor surfaces use `p-*`; both read the same
tokens.

---

## 1. Design language (the five rules)

1. **One accent.** Marine scarlet `#b3122e`. Never introduce a second brand hue; status colors
   (green/amber/orange) are functional only.
2. **Borderless cards.** No 1px borders. Depth is a soft shadow + a half-pixel hairline, both baked
   into `--p-shadow`. Cards float on the gray ground.
3. **18px radius** on cards/panels; **980px** (pill) on buttons and chips; 8–12px on small controls.
4. **System font.** `-apple-system, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui`.
   Mono only for code/citations/tabular numbers (`"SF Mono", "Cascadia Code", Consolas, ui-monospace`).
5. **Light-committed.** No dark mode. Paint `background` explicitly on the root; never rely on the UA.

---

## 2. Tokens (copy verbatim)

```css
:root, .p-root{
  /* ground + surfaces */
  --p-bg:#f5f5f7;            /* app ground */
  --p-surface:#ffffff;       /* cards, panels */
  --p-surface-2:#ececef;     /* insets, wells, textareas */
  --p-border:rgba(0,0,0,.08);
  --p-border-soft:rgba(0,0,0,.06);
  /* ink */
  --p-text:#1d1d1f;
  --p-dim:#6e6e73;
  --p-faint:#86868b;
  --p-ink:#1d1d1f;           /* the one dark object (primary CTA, avatars) */
  /* the frosted rail */
  --p-rail:rgba(255,255,255,.72);
  /* the single accent */
  --p-accent:#b3122e;
  --p-accent-bright:#e0334f;
  --p-accent-tint:rgba(179,18,46,.10);
  /* functional status */
  --p-good:#1e7a3c;
  --p-warning:#b0731a;
  --p-critical:#c2410c;
  --p-critical-tint:#fff5f0;
  --p-seq:#8a95a3;           /* neutral sequence/sparkline bars */
  /* elevation */
  --p-shadow:0 2px 12px rgba(0,0,0,.06), 0 0 0 .5px rgba(0,0,0,.04);
  --p-shadow-lift:0 10px 28px rgba(0,0,0,.10), 0 0 0 .5px rgba(0,0,0,.04);
  /* shape + type */
  --p-radius:18px;
  --p-sans:-apple-system,"SF Pro Text","Segoe UI Variable Text","Segoe UI",system-ui,sans-serif;
  --p-mono:"SF Mono","Cascadia Code",Consolas,ui-monospace,monospace;
}
```

**Semantic "kind" colors** (calendar chips, event dots, legends) — `--k` is the mark color, `--k-bg` the fill:

```css
.class { --k:#3b5b8c;            --k-bg:#e8eef8; }   /* class event   */
.exam  { --k:var(--p-accent);    --k-bg:var(--p-accent-tint); }
.plan  { --k:var(--p-good);      --k-bg:#e8f4ec; }   /* study plan     */
.todo  { --k:var(--p-warning);   --k-bg:#fdf3e2; }
.req   { --k:#6b7280;            --k-bg:#eef0f3; }   /* requirement    */
.late  { --k:var(--p-critical);  --k-bg:var(--p-critical-tint); }
```

Elevation rule: a resting card uses `--p-shadow`; on hover it lifts to `--p-shadow-lift` with
`transform:translateY(-1px)`. Nothing else moves.

---

## 3. The shell

Three columns: **frosted rail → content (breadcrumb + main) → agenda**. The rail is `position:sticky`,
full height, blurred glass. The main column scrolls; the agenda sits beside the main inside the
container.

```css
body{margin:0;display:flex;min-height:100vh;background:var(--p-bg);color:var(--p-text);
  font-family:var(--p-sans);line-height:1.5;-webkit-font-smoothing:antialiased;overflow-x:hidden}
html{overflow-x:hidden}
.root{flex:1;display:flex;min-height:0;--rail-w:15rem;--agenda-w:20rem;--max:82rem}

/* frosted rail */
.rail{width:var(--rail-w);flex:none;position:sticky;top:0;height:100vh;overflow-y:auto;
  background:var(--p-rail);backdrop-filter:blur(24px) saturate(180%);
  border-right:.5px solid var(--p-border);
  display:flex;flex-direction:column;padding:1.3rem .75rem 1rem;gap:.1rem}
.rail-user{display:flex;align-items:center;gap:.65rem;padding:.3rem .6rem 1rem}
.avatar{width:2.2rem;height:2.2rem;border-radius:11px;flex:none;display:grid;place-items:center;
  background:linear-gradient(135deg,var(--p-accent),var(--p-accent-bright));color:#fff;font-size:.75em;font-weight:700}
.navbtn{display:flex;align-items:center;gap:.75rem;width:100%;text-align:left;background:none;border:none;
  border-radius:10px;color:var(--p-text);font:inherit;font-size:.96em;padding:.55rem .8rem;cursor:pointer;text-decoration:none}
.navbtn:hover{background:rgba(0,0,0,.05)}
.navbtn.on{background:var(--p-accent-tint);color:var(--p-accent);font-weight:600}
.navbtn .ico{width:1.25rem;height:1.25rem;flex:none;color:var(--p-faint)}
.navbtn.on .ico{color:var(--p-accent)}
.navlabel{font-size:.72em;font-weight:600;color:var(--p-faint);text-transform:uppercase;letter-spacing:.06em;padding:1rem .8rem .3rem}
.rail-sp{flex:1}                      /* pushes footer nav to the bottom */

/* content + agenda */
.content{flex:1;min-width:0;display:flex;flex-direction:column}   /* min-width:0 is load-bearing */
.crumbs{display:flex;align-items:center;gap:.5rem;padding:.9rem 2.4rem 0;font-size:.82em;color:var(--p-faint)}
.main{flex:1;padding:.7rem 2.4rem 3.5rem}
.container{max-width:var(--max);margin:0 auto}
.two{display:grid;grid-template-columns:minmax(0,1fr) var(--agenda-w);gap:1.6rem;align-items:start}
.two>*{min-width:0}                   /* let grid children shrink; kills overflow */
.agenda{display:flex;flex-direction:column;gap:1.2rem;padding-top:4.2rem}  /* aligns with pagehead */
```

Rail anatomy top→bottom: **avatar + name/role** → **role segmented switch** (`Instructor | Student`) →
**nav group label + icon nav** (active item = scarlet tinted pill, scarlet icon) → **"My courses"** shortcuts
(colored dot + name) → spacer → **footer links** (dim: "How it integrates", "Overview", "Open source ↗").

Page head:
```css
.pagehead h1{margin:0 0 .3rem;font-size:2.1em;letter-spacing:-.026em;font-weight:700;line-height:1.1}
.pagehead h1 code{font-size:.42em;vertical-align:middle}       /* course codes ride the headline */
.pagehead p{margin:0;color:var(--p-dim);font-size:1.02em;max-width:66ch}
.label{margin:1.5rem 0 .7rem;font-size:.85em;color:var(--p-faint);font-weight:600}  /* section label */
/* per-screen "powered by" repo chips */
.uses{display:flex;gap:.4rem;flex-wrap:wrap;margin-top:.8rem}
.uses .u{font-family:var(--p-mono);font-size:.7em;color:var(--p-dim);background:rgba(0,0,0,.05);border-radius:980px;padding:.22em .7em}
```

---

## 4. Component catalog

Shared card treatment — apply to every surface, then specialize:
```css
.card,.next-card,.box,.req,.tile,.coacard,.panel,.item{
  background:var(--p-surface);border:none;box-shadow:var(--p-shadow);border-radius:var(--p-radius)}
```

**Stat tiles** — the at-a-glance row.
```css
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(11rem,1fr));gap:1rem;margin-bottom:1.4rem}
.tile{padding:1.1rem 1.3rem}
.tilelab{font-size:.82em;font-weight:600;color:var(--p-faint)}
.tileval{font-size:2.2em;font-weight:700;letter-spacing:-.03em;line-height:1.1;margin-top:.2rem}
.tileval.good{color:var(--p-good)} .tileval.warn{color:var(--p-warning)} .tileval.crit{color:var(--p-critical)}
.tilenote{font-size:.82em;color:var(--p-dim);margin-top:.15rem}
```

**Course / entity card** — big mastery number + progress bar.
```css
.card{padding:1.3rem 1.4rem;display:flex;flex-direction:column;gap:.9rem;text-align:left}
.card.click{cursor:pointer;transition:box-shadow .15s,transform .15s}
.card.click:hover{box-shadow:var(--p-shadow-lift);transform:translateY(-1px)}
.card-avg span{font-size:2.2em;font-weight:700;letter-spacing:-.03em}     /* the % */
.card-avg small{font-size:.7em;color:var(--p-faint);text-transform:uppercase;letter-spacing:.06em}
.prog{display:flex;flex-direction:column;gap:.35rem;font-size:.8em;color:var(--p-faint)}
.track{height:.4rem;background:rgba(0,0,0,.06);border-radius:980px;overflow:hidden}
.fill{height:100%;background:var(--p-accent);border-radius:980px;transition:width .6s cubic-bezier(.2,.8,.2,1)}
```
Use `background:var(--p-good)` on `.fill` for on-track courses; scarlet is the default/at-risk.

**"Up next" / entry cards** — `.next-card` (scarlet `next-kind` eyebrow; `.late` variant swaps to
`--p-critical-tint` ground + critical eyebrow).

**The one dark object** — the single primary CTA per screen, on `--p-ink`. Use sparingly (it draws the
eye): "Walk a generated course", "Continue where you left off".
```css
.s-continue{display:flex;align-items:center;gap:1.25rem;background:var(--p-ink);color:#fff;
  border-radius:var(--p-radius);padding:1.3rem 1.5rem;box-shadow:0 8px 28px rgba(0,0,0,.18);cursor:pointer}
.s-continue-btn{background:#fff;color:var(--p-ink);border-radius:980px;height:2.4rem;padding:0 1.1rem;font-weight:600}
```

**Buttons.**
```css
.btn{background:var(--p-accent);color:#fff;border:none;border-radius:980px;height:2.5rem;padding:0 1.2rem;
  font:inherit;font-size:.92em;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:.5rem}
.btn:hover{filter:brightness(1.12)} .btn:disabled{opacity:.45;cursor:default;filter:none}
.btn.ghost{background:rgba(0,0,0,.05);color:var(--p-text)}
.btn.sm{height:2rem;font-size:.85em;padding:0 .9rem}
```

**Generation pipeline** (Studio) — spinner dot → green check.
```css
.steps{list-style:none;margin:.4rem 0 0;padding:0;display:flex;flex-direction:column;gap:.55rem}
.step{display:flex;align-items:center;gap:.7rem;font-size:.9em;color:var(--p-faint)}
.step.run{color:var(--p-text)} .step.done{color:var(--p-dim)}
.stepdot{width:1.2em;height:1.2em;border-radius:50%;border:2px solid var(--p-border);box-sizing:border-box}
.step.run .stepdot{border-color:var(--p-accent);border-right-color:transparent;animation:spin .7s linear infinite}
.step.done .stepdot{border-color:var(--p-good);background:var(--p-good)}
@keyframes spin{to{transform:rotate(360deg)}}
```

**Generated / review items** with an approval state pill.
```css
.item{padding:1rem 1.2rem;margin-bottom:.8rem;display:flex;flex-direction:column;gap:.5rem;animation:bloom .35s both}
@keyframes bloom{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.item-kind{font-size:.72em;font-family:var(--p-mono);text-transform:uppercase;letter-spacing:.06em;color:var(--p-faint)}
.statepill{margin-left:auto;font-size:.7em;font-weight:700;text-transform:uppercase;letter-spacing:.04em;padding:.15em .6em;border-radius:980px}
.statepill.pending{background:rgba(176,115,26,.14);color:var(--p-warning)}
.statepill.approved{background:rgba(30,122,60,.12);color:var(--p-good)}
.statepill.rejected{background:var(--p-critical-tint);color:var(--p-critical)}
```

**Mastery chart** — label / bar / value rows (worst-first). Bar color by band:
`<65 critical, <75 warning, else good`.
```css
.chart{display:flex;flex-direction:column;gap:.6rem}
.crow{display:grid;grid-template-columns:11rem 1fr 4rem;align-items:center;gap:.8rem}
.crow .cl{font-size:.86em;color:var(--p-dim);text-align:right}
.crow .cv{font-size:.86em;font-weight:600;font-variant-numeric:tabular-nums}
```

**Table.**
```css
table.t{width:100%;border-collapse:collapse;font-size:.88em}
table.t th{text-align:left;font-size:.8em;color:var(--p-faint);font-weight:600;padding:.5rem .6rem;border-bottom:.5px solid var(--p-border)}
table.t td{padding:.6rem .6rem;border-bottom:.5px solid var(--p-border);color:var(--p-dim)}
table.t tr:last-child td{border-bottom:none} table.t td:first-child{color:var(--p-text);font-weight:500}
.tablewrap{overflow-x:auto}   /* wrap every table so it never widens the page */
.tag{font-size:.72em;font-weight:600;padding:.1em .55em;border-radius:980px}
.tag.g{background:rgba(30,122,60,.12);color:var(--p-good)} .tag.w{background:rgba(176,115,26,.14);color:var(--p-warning)} .tag.c{background:var(--p-critical-tint);color:var(--p-critical)}
```

**Quiz answers** (`p-ans`): resting hairline; `.correct` → green ring + tint; `.wrong` → critical ring + tint;
the answer key chip fills with the state color. Rationale block sits below on `--p-bg` with a scarlet label.

**Rubric BARS tiers** — three `item`s labeled Unsatisfactory (critical), Satisfactory (warning),
Proficient (good) via the `item-kind` color; each carries a right-aligned `cite` back to a performance step.

**AAR findings + trend sparkline.**
```css
.find{border-left:3px solid var(--p-border);padding:.2rem 0 .2rem .9rem;margin-bottom:.9rem}
.find.crit{border-left-color:var(--p-critical)} .find.warn{border-left-color:var(--p-warning)} .find.good{border-left-color:var(--p-good)}
.horizon{font-size:.68em;font-family:var(--p-mono);text-transform:uppercase;letter-spacing:.05em;padding:.1em .5em;border-radius:5px;background:rgba(0,0,0,.05);color:var(--p-dim)}
.spark{display:flex;align-items:flex-end;gap:5px;height:3rem}
.sparkbar{flex:1;background:var(--p-seq);border-radius:3px 3px 0 0;min-height:3px}
.sparkbar.last{background:var(--p-critical)}
```

**Chat bubbles** (Ask + Mastery). `me` = scarlet, right; `ai` = white card, left; `ai.refuse` = critical
inset ring. Answers carry a `vbadge` (ok/mid) verdict chip and, when grounded, a fidelity note.
```css
.bubble{max-width:82%;padding:.8rem 1.1rem;border-radius:16px;font-size:.92em;line-height:1.5}
.bubble.me{align-self:flex-end;background:var(--p-accent);color:#fff;border-bottom-right-radius:5px;font-weight:500}
.bubble.ai{align-self:flex-start;background:var(--p-surface);box-shadow:var(--p-shadow);border-bottom-left-radius:5px}
.bubble.ai.refuse{box-shadow:inset 0 0 0 1px rgba(194,65,12,.3)}
.vbadge.ok{background:rgba(30,122,60,.12);color:var(--p-good)} .vbadge.mid{background:rgba(176,115,26,.14);color:var(--p-warning)}
.chip{background:var(--p-surface);box-shadow:0 0 0 .5px rgba(0,0,0,.12);border-radius:980px;padding:.4rem .9rem;font-size:.85em;color:var(--p-dim);cursor:pointer}
.chip:hover{box-shadow:0 0 0 1.5px var(--p-accent);color:var(--p-text)} .chip.refuse{color:var(--p-critical)}
```

**Study-plan COA cards** (3-across, `.on` = scarlet ring + tint) + **mini month calendar** (7-col grid,
`cal-chip` events tinted by `--k`, today's number filled scarlet). On phones the calendar scrolls inside
its own `overflow-x:auto` box (`min-width:21rem`).

**Citations + grounded-passage modal** — the mic-drop. Every `cite` is a clickable mono chip that opens a
centered modal showing the exact passage + locator (green left-border on the passage, `z-index:90` so it
sits above the widgets).
```css
.cite{display:inline-block;font-family:var(--p-mono);font-size:.74em;color:var(--p-dim);background:rgba(0,0,0,.05);border-radius:6px;padding:.12em .5em;cursor:pointer;transition:box-shadow .12s,color .12s}
.cite:hover{box-shadow:inset 0 0 0 1px var(--p-accent);color:var(--p-accent)}
.modal{position:fixed;inset:0;background:rgba(0,0,0,.4);display:grid;place-items:center;z-index:90;padding:1.2rem}
.modal-card{background:var(--p-surface);border-radius:var(--p-radius);box-shadow:var(--p-shadow-lift);max-width:36rem;width:100%;padding:1.5rem 1.7rem}
.modal-card .ptext{background:var(--p-bg);border-radius:12px;padding:1rem 1.2rem;border-left:3px solid var(--p-good);line-height:1.6}
```

**Coverage / requirement rows** (`req` / `reqrow`) — a status dot + name + status text; used for
required-training and the "every ask on the board" mapping.

**Badges** — grounded (`.badge.ok`, green) and refused (`.badge.no`, critical inset ring).

---

## 5. The two floating widgets

Persistent across the app; both `position:fixed`, above content (`z-index:70` FAB / `71` panel; below the
citation modal at 90).

**Ask-tutor (bottom-right, scarlet).** A round FAB opens a compact grounded chat panel (chips + free
input, cite-or-refuse answers with HHEM badge + fidelity note, clickable citations). This is the
tutor-as-widget: on the live build it calls Anchor `/api/ask` (see `04-grounding-and-anchor.md`).
```css
.fab{position:fixed;bottom:1.3rem;width:3.4rem;height:3.4rem;border-radius:50%;border:none;cursor:pointer;
  display:grid;place-items:center;color:#fff;box-shadow:0 8px 24px rgba(0,0,0,.28);z-index:70}
.fab.ask{right:1.3rem;background:var(--p-accent)}
.wgt{position:fixed;bottom:5.4rem;width:22rem;max-width:calc(100vw - 2rem);background:var(--p-surface);
  border-radius:16px;box-shadow:0 18px 50px rgba(0,0,0,.3),0 0 0 .5px rgba(0,0,0,.08);z-index:71;
  display:flex;flex-direction:column;overflow:hidden}
.wgt.ask{right:1.3rem;height:30rem;max-height:calc(100vh - 8rem)}
```

**QA issue-reporter (bottom-left, dark — clear of the rail).** A dark FAB opens a form (type + note) that
**auto-captures where the reviewer is** (role, view, lesson, URL, viewport, timestamp) and opens a
prefilled GitHub issue on the repo. Positioned past the rail so it never sits on the sidebar:
```css
.fab.issue{left:16.3rem;background:var(--p-ink)}      /* just past the 15rem rail */
.wgt.issue{left:16.3rem;max-height:calc(100vh - 8rem)}
@media(max-width:900px){.fab.issue{left:5.2rem} .wgt.issue{left:1.3rem}}   /* rail collapsed */
@media(max-width:520px){.wgt{width:calc(100vw - 1.6rem)} .fab.ask{right:.9rem} .fab.issue{left:.9rem}}
```
Issue submit builds: `https://github.com/<owner>/<repo>/issues/new?title=…&body=…&labels=qa,<type>` with the
captured context in the body, and opens it in a new tab. (On the real repo this becomes a dev-mode button
that POSTs via the GitHub API / an issues endpoint.)

---

## 6. Responsive discipline

- **≤1100px** — `.two` collapses to one column; the agenda becomes a wrapping row (`flex-direction:row;flex-wrap:wrap`), each box `flex:1 1 15rem;min-width:0`. Below **760px** the agenda stacks to a column.
- **≤900px** — the rail collapses to a `4.2rem` icon strip: hide `rail-who`/labels/`navlabel`/footer text, center the icons. Main/breadcrumb padding drops to `1.1rem`.
- **Phone** — tiles go 2-up then 1-up; the calendar scrolls inside its box (`#calWrap{overflow-x:auto}.cal{min-width:21rem}`); COA cards stack.
- **No horizontal overflow, ever.** `html,body{overflow-x:hidden}`, `min-width:0` on flex/grid children (`.content`, `.two>*`, agenda boxes), and every table/diagram/calendar in its own `overflow-x:auto` wrapper. Verify `document.documentElement.scrollWidth <= innerWidth` on each screen at 390px.

---

## 7. Prototype / disclaimer banner

When shipping a mock/showcase build, put an honest striped banner at the top of the content column so a
reviewer never mistakes it for live:
```css
.protobar{background:repeating-linear-gradient(45deg,#fff3d6,#fff3d6 10px,#fbe9c2 10px,#fbe9c2 20px);
  color:#6b4a0e;font-size:.76rem;padding:.4rem 2.4rem;border-bottom:.5px solid #ecd39a}
.protobar b{color:#8a5a00}
```
> ◆ **Interactive prototype** — illustrative mock data. The live platform runs on the real repos + Anchor.

---

## 8. Motion & a11y

- Transitions: `.15s` for hover lifts, `.6s cubic-bezier(.2,.8,.2,1)` for progress-bar fills, `.35s bloom`
  for newly-generated items. Nothing bounces.
- Every interactive element is a real `<button>`/`<a>` (chips included, ideally) so it's keyboard- and
  screen-reader-reachable; `Escape` closes modals and widgets.
- Contrast: `--p-dim` on `--p-surface` and white-on-scarlet both clear AA at body size. Keep status text
  ≥ `.8em` for legibility.
