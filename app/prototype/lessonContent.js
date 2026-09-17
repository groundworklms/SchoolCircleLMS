/* Lesson content — the import-ready model.

   A lesson is an ORDERED LIST OF ITEMS, one idea per screen. The student moves
   through them one at a time (Moodle Lesson pages; Canvas module items). Some
   items gate progress: a `check` must be answered before Next unlocks.

   Item types (map directly to Moodle modules / IMS CC resources — see docs/IMPORT.md):
     page        { title, blocks }                 content page (Moodle: lesson content page / page / book chapter)
     check       { title, q, answers, rationale }  question page (Moodle: lesson question page)
     practice    { title, text }                   link to the lesson's practice set (Moodle: quiz)
     attachments { title }                         files for this lesson (Moodle: resource/file)

   Blocks inside a page:
     p, h, list, callout{kind,title,text}, terms{items}, figure{caption,svg}, example{title,steps,result}
   Interactive blocks (the H5P content types a schoolhouse actually uses):
     accordion  { items: [{ title, text }] }                          H5P Accordion
     hotspots   { svg, caption, spots: [{ x, y, title, text }] }      H5P Image Hotspots — x,y in %
     video      { title, duration, poster, prompts: [{ at, kind, text, q?, answers? }] }  H5P Interactive Video
     flashcards { cards: [{ front, back }] }                          H5P Dialog Cards / Flashcards

   Two lessons are authored here. Every other lesson gets a scaffold built
   from its POI structure (contentFor), labelled as not yet authored.
*/

const TRANSFORMER_SVG = `
<svg viewBox="0 0 520 220" xmlns="http://www.w3.org/2000/svg" font-family="inherit" font-size="13">
  <defs><marker id="a" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#6e6e73"/></marker></defs>
  <!-- core -->
  <rect x="215" y="30" width="14" height="160" fill="#d2d2d7"/>
  <rect x="291" y="30" width="14" height="160" fill="#d2d2d7"/>
  <text x="260" y="22" text-anchor="middle" fill="#86868b">laminated core</text>
  <!-- primary -->
  <path d="M200,50 c-20,0 -20,20 0,20 c-20,0 -20,20 0,20 c-20,0 -20,20 0,20 c-20,0 -20,20 0,20 c-20,0 -20,20 0,20" fill="none" stroke="#b3122e" stroke-width="3"/>
  <line x1="200" y1="50" x2="100" y2="50" stroke="#1d1d1f" stroke-width="2"/>
  <line x1="200" y1="150" x2="100" y2="150" stroke="#1d1d1f" stroke-width="2"/>
  <text x="100" y="42" fill="#1d1d1f">V<tspan baseline-shift="sub" font-size="10">p</tspan></text>
  <text x="186" y="105" text-anchor="end" fill="#b3122e" font-weight="600">N<tspan baseline-shift="sub" font-size="10">p</tspan> = 100</text>
  <line x1="112" y1="60" x2="112" y2="140" stroke="#6e6e73" stroke-width="1.5" marker-end="url(#a)"/>
  <!-- secondary -->
  <path d="M320,50 c20,0 20,20 0,20 c20,0 20,20 0,20 c20,0 20,20 0,20 c20,0 20,20 0,20 c20,0 20,20 0,20" fill="none" stroke="#3b5b8c" stroke-width="3"/>
  <line x1="320" y1="50" x2="420" y2="50" stroke="#1d1d1f" stroke-width="2"/>
  <line x1="320" y1="150" x2="420" y2="150" stroke="#1d1d1f" stroke-width="2"/>
  <text x="405" y="42" fill="#1d1d1f">V<tspan baseline-shift="sub" font-size="10">s</tspan></text>
  <text x="334" y="105" fill="#3b5b8c" font-weight="600">N<tspan baseline-shift="sub" font-size="10">s</tspan> = 500</text>
  <line x1="408" y1="60" x2="408" y2="140" stroke="#6e6e73" stroke-width="1.5" marker-end="url(#a)"/>
  <!-- ratio -->
  <text x="260" y="210" text-anchor="middle" fill="#1d1d1f" font-weight="600">V<tspan baseline-shift="sub" font-size="10">s</tspan> / V<tspan baseline-shift="sub" font-size="10">p</tspan> = N<tspan baseline-shift="sub" font-size="10">s</tspan> / N<tspan baseline-shift="sub" font-size="10">p</tspan> = 5   (step-up)</text>
</svg>`;

const AUTHORED = {
  'BE.02.04': {
    intro:
      'A transformer moves electrical energy from one circuit to another through a shared magnetic field, with no electrical connection between them. Every radio, power supply and test set you will touch in this course has at least one. This lesson is about what a transformer does to voltage, current and impedance, why it does it, and how to tell a good one from a bad one on the bench.',
    items: [
      { type: 'page', title: 'How a transformer works', blocks: [
        { type: 'p', text: 'Two coils of wire — the primary and the secondary — are wound on a common core. Alternating current in the primary produces a changing magnetic field in the core. That changing field cuts the turns of the secondary and induces a voltage in it. This is mutual induction, and it only works with a changing field: a transformer does nothing with DC.' },
        { type: 'callout', kind: 'note', title: 'No DC through a transformer', text: 'If you connect a transformer primary to a DC source, the field builds once and then stops changing. No voltage is induced in the secondary, and the primary winding — which has very low DC resistance — draws heavy current and overheats. This is the first thing to check when a transformer has burned up.' },
      ] },
      { type: 'page', title: 'Anatomy of a transformer', blocks: [
        { type: 'p', text: 'Tap each point on the diagram.' },
        { type: 'hotspots', svg: TRANSFORMER_SVG, caption: 'Figure 1. A step-up transformer, 100 turns on the primary and 500 on the secondary.', spots: [
          { x: 24, y: 52, title: 'Primary winding', text: 'The coil connected to the source. AC here creates the changing magnetic field. Its resistance is low — that is why DC on the primary burns it up.' },
          { x: 50, y: 14, title: 'Laminated core', text: 'Thin insulated iron sheets stacked together. The laminations break up eddy currents that would otherwise heat the core and waste power.' },
          { x: 76, y: 52, title: 'Secondary winding', text: 'The coil connected to the load. Voltage is induced here by the changing field. More turns than the primary means step-up; fewer means step-down.' },
          { x: 50, y: 95, title: 'Turns ratio', text: 'Nₛ / Nₚ = 500 / 100 = 5. The secondary voltage is five times the primary; the available current is one fifth.' },
        ] },
        { type: 'p', text: 'The core matters. Iron or ferrite concentrates the magnetic field so nearly all of it links both coils. The core is built from thin laminated sheets rather than a solid block to limit eddy currents — circulating currents in the core that would otherwise heat it and waste power.' },
      ] },
      { type: 'page', title: 'The turns ratio', blocks: [
        { type: 'p', text: 'The relationship between primary and secondary voltage is set by the number of turns on each coil. The ratio of secondary turns to primary turns is the turns ratio, and the voltages follow it exactly in an ideal transformer.' },
        { type: 'terms', items: [
            ['Turns ratio', 'Nₛ / Nₚ. More secondary turns than primary is step-up; fewer is step-down.'],
            ['Voltage ratio', 'Vₛ / Vₚ = Nₛ / Nₚ. Voltage scales with the turns ratio.'],
            ['Current ratio', 'Iₛ / Iₚ = Nₚ / Nₛ. Current scales inversely — step the voltage up and the current comes down.'],
            ['Impedance ratio', 'Zₚ / Zₛ = (Nₚ / Nₛ)². Impedance scales with the square of the turns ratio.'],
          ] },
      ] },
      { type: 'page', title: 'Power in, power out', blocks: [
        { type: 'p', text: 'Power in equals power out in the ideal case: Vₚ × Iₚ = Vₛ × Iₛ. A transformer does not create power. Step the voltage up five times and the available current comes down to a fifth. Real transformers lose a few percent to heat, which is why they get warm.' },
        { type: 'example', title: 'Worked example — step-down supply transformer', steps: [
            'Primary: 120 V, 200 turns. Secondary: 20 turns. Load on the secondary draws 2 A.',
            'Turns ratio = 20 / 200 = 0.1, so Vₛ = 120 × 0.1 = 12 V.',
            'Current ratio is the inverse: Iₚ = Iₛ × (Nₛ / Nₚ) = 2 × 0.1 = 0.2 A.',
            'Check the power: 120 × 0.2 = 24 W in; 12 × 2 = 24 W out.',
          ], result: 'A 10:1 step-down transformer delivers 12 V at 2 A from a 120 V primary drawing 0.2 A.' },
      ] },
      { type: 'check', title: 'Check: turns ratio', q: 'A transformer has 50 primary turns and 400 secondary turns. 24 V is applied to the primary. What is the secondary voltage?', answers: [
            { text: '3 V', correct: false },
            { text: '192 V', correct: true },
            { text: '24 V', correct: false },
            { text: '1,200 V', correct: false },
          ], rationale: 'Turns ratio is 400 / 50 = 8, so Vₛ = 24 × 8 = 192 V. Step-up multiplies. 3 V is what you get if you invert the ratio; 1,200 V is 24 × 50, which uses the primary turns alone.' },
      { type: 'page', title: 'Impedance matching', blocks: [
        { type: 'p', text: 'The impedance ratio is the reason transformers show up between a transmitter and an antenna, or between an amplifier and a speaker. Maximum power transfers when source and load impedances match. A transformer lets you present a load of one impedance to a source expecting another — and because impedance goes with the square of the turns ratio, a modest ratio makes a large impedance change.' },
        { type: 'example', title: 'Worked example — matching a 50 Ω source to an 800 Ω load', steps: [
            'Required impedance ratio Zₚ / Zₛ = 50 / 800 = 1/16.',
            'Turns ratio is the square root: Nₚ / Nₛ = √(1/16) = 1/4.',
            'So a 1:4 step-up transformer makes the 800 Ω load look like 50 Ω to the source.',
          ], result: 'A 1:4 turns ratio gives a 1:16 impedance ratio.' },
        { type: 'callout', kind: 'tip', title: 'Where you will meet this again', text: 'Annex C — Transmission Lines. A mismatch between a transmitter and its antenna is what produces the reflected power you will measure as SWR. Matching transformers (baluns) are one way to fix it.' },
      ] },
      { type: 'page', title: 'Losses and ratings', blocks: [
        { type: 'p', text: 'A real transformer is rated in volt-amperes (VA), not watts, because it has to handle the current regardless of the power factor of the load. Its losses come in two families.' },
        { type: 'list', items: [
            'Copper losses — I²R heating in the windings. They rise with load current.',
            'Core losses — eddy currents and hysteresis in the core. They are present whenever the primary is energised, loaded or not, and rise with frequency.',
          ] },
        { type: 'p', text: 'Because core losses depend on frequency, a transformer designed for 60 Hz will saturate and overheat on a lower frequency, and one designed for audio or RF is built on a different core material entirely. Never substitute a transformer by voltage rating alone.' },
      ] },
      { type: 'check', title: 'Check: losses', q: 'A transformer runs warm with nothing connected to its secondary. Which loss is responsible?', answers: [
            { text: 'Copper loss in the secondary', correct: false },
            { text: 'Core loss', correct: true },
            { text: 'Copper loss in the primary under load', correct: false },
            { text: 'There is no loss with no load — the transformer is faulty', correct: false },
          ], rationale: 'With no load there is almost no current in either winding, so copper losses are near zero. Core losses — eddy currents and hysteresis — happen whenever the core is magnetised, which is any time the primary is energised. A warm unloaded transformer is normal.' },
      { type: 'page', title: 'On the bench: checking a transformer', blocks: [
        { type: 'callout', kind: 'warn', title: 'De-energise first', text: 'Confirm the primary is disconnected and any associated capacitors are discharged before you put a meter on a transformer. Secondary voltages on power transformers can be lethal.' },
        { type: 'p', text: 'Most transformer faults are one of three things, and an ohmmeter finds all of them. Open each one.' },
        { type: 'accordion', items: [
          { title: 'Open winding', text: 'Infinite resistance across a winding. The transformer is dead on that winding. Common cause: overheating from a DC or overload event. Meter reads OL across the winding.' },
          { title: 'Shorted turns', text: 'Winding resistance noticeably below the value on the data plate, or below its twin winding. The transformer runs hot and the output voltage is low. This is the one that looks "almost fine" on a quick check.' },
          { title: 'Short to core', text: 'Continuity between any winding and the core or frame. Dangerous — the frame can be live. Replace the transformer; do not attempt to repair it.' },
        ] },
        { type: 'p', text: 'If the resistances look right, energise the primary at rated voltage with the secondary unloaded and measure the secondary. It should read slightly above the rated voltage — the no-load voltage — and drop toward rated under load. An output that is far off suggests the wrong transformer, not a faulty one.' },
      ] },
      { type: 'check', title: 'Check: bench faults', q: 'You measure 0.8 Ω across a primary rated at 4 Ω and the secondary reads normal. What is the most likely fault?', answers: [
            { text: 'Open primary', correct: false },
            { text: 'Shorted turns in the primary', correct: true },
            { text: 'Short to core', correct: false },
            { text: 'Nothing — 0.8 Ω is within tolerance', correct: false },
          ], rationale: 'Resistance well below the rated value means some of the turns are shorted out of the circuit. An open would read infinite. A short to core is tested winding-to-frame, not across the winding. 0.8 Ω against a 4 Ω rating is not tolerance; it is a fault.' },
      { type: 'page', title: 'Watch: bench check, start to finish', blocks: [
        { type: 'video', title: 'Bench-checking a power transformer', duration: 214, poster: 'Instructor demonstration · 3:34', prompts: [
          { at: 18, kind: 'note', text: 'Primary disconnected and capacitors discharged before the meter goes anywhere near it.' },
          { at: 61, kind: 'question', q: 'The meter shows OL across the secondary. What is the fault?', answers: [{ text: 'Open winding', correct: true }, { text: 'Shorted turns', correct: false }, { text: 'Short to core', correct: false }] },
          { at: 122, kind: 'question', q: 'Winding-to-frame reads 0.3 Ω. What do you do?', answers: [{ text: 'Replace the transformer', correct: true }, { text: 'Re-tape the winding', correct: false }, { text: 'Energise it and measure output', correct: false }] },
          { at: 190, kind: 'note', text: 'No-load secondary reads a little above rated — that is normal. It should drop toward rated under load.' },
        ] },
      ] },
      { type: 'page', title: 'Flashcards: terms to know cold', blocks: [
        { type: 'p', text: 'Flip each card. These come up on the annex exam in exactly this form.' },
        { type: 'flashcards', cards: [
          { front: 'Turns ratio', back: 'Nₛ / Nₚ. Greater than 1 is step-up.' },
          { front: 'Voltage ratio', back: 'Vₛ / Vₚ = Nₛ / Nₚ' },
          { front: 'Current ratio', back: 'Iₛ / Iₚ = Nₚ / Nₛ — the inverse of the turns ratio.' },
          { front: 'Impedance ratio', back: 'Zₚ / Zₛ = (Nₚ / Nₛ)² — the square.' },
          { front: 'Core loss', back: 'Eddy currents + hysteresis. Present whenever energised, loaded or not.' },
          { front: 'Copper loss', back: 'I²R in the windings. Rises with load current.' },
        ] },
      ] },
      { type: 'practice', title: 'Practice set', text: 'Twelve adaptive questions, weighted to what you have missed. Not graded.' },
      { type: 'attachments', title: 'Attachments' },
    ],
  },
  'TI.01.02': {
    intro:
      'Every device on a network needs an address, and every address has two parts: which network it is on and which host it is within that network. Where the line between those two parts falls is the whole subject of this lesson. Get it right and routing makes sense; get it wrong and nothing talks to anything.',
    items: [
      { type: 'page', title: 'What an IPv4 address is', blocks: [
        { type: 'p', text: 'An IPv4 address is 32 bits, written as four decimal octets separated by dots: 192.168.10.37. Each octet is 8 bits, so it ranges from 0 to 255. The address by itself does not tell you where the network part ends — that is the job of the subnet mask.' },
        { type: 'terms', items: [
            ['Octet', 'One of the four 8-bit groups. 192.168.10.37 has octets 192, 168, 10 and 37.'],
            ['Subnet mask', 'A 32-bit pattern of ones followed by zeros. Ones mark the network bits; zeros mark the host bits.'],
            ['Prefix length', 'The number of ones in the mask, written /24. 255.255.255.0 and /24 are the same thing.'],
            ['Network address', 'All host bits zero. Identifies the subnet; cannot be assigned to a device.'],
            ['Broadcast address', 'All host bits one. Reaches every host on the subnet; cannot be assigned to a device.'],
          ] },
      ] },
      { type: 'page', title: 'Two addresses you can never assign', blocks: [
        { type: 'callout', kind: 'note', title: 'Two addresses you can never assign', text: 'The network address and the broadcast address are reserved in every subnet. A /24 has 256 addresses but only 254 usable hosts. Assign either reserved address to a device and it will not communicate — and the symptom looks like a cabling fault.' },
      ] },
      { type: 'page', title: 'Applying the mask', blocks: [
        { type: 'p', text: 'To find the network a host is on, AND the address with the mask bit by bit. Where the mask is 1, the address bit is kept; where it is 0, the result is 0. Working in binary is the reliable way; the shortcut only works once you can do it in binary without thinking.' },
        { type: 'example', title: 'Worked example — 192.168.10.37 /26', steps: [
            '/26 means 26 ones: mask = 255.255.255.192. The first three octets are all network.',
            'Fourth octet: 37 = 00100101. Mask 192 = 11000000.',
            'AND: 00100101 & 11000000 = 00000000 = 0. Network = 192.168.10.0/26.',
            'Host bits: 6, so 2⁶ = 64 addresses per subnet, 62 usable. This subnet runs 192.168.10.0 to 192.168.10.63.',
            'Broadcast: host bits all one → 00111111 = 63. Broadcast = 192.168.10.63.',
          ], result: '192.168.10.37/26 is host 37 on network 192.168.10.0/26; usable range .1 to .62; broadcast .63.' },
      ] },
      { type: 'check', title: 'Check: find the network', q: 'What is the network address of 10.20.130.200 /25?', answers: [
            { text: '10.20.130.0', correct: false },
            { text: '10.20.130.128', correct: true },
            { text: '10.20.130.200', correct: false },
            { text: '10.20.0.0', correct: false },
          ], rationale: '/25 leaves 7 host bits, so subnets are 128 addresses wide: .0–.127 and .128–.255. 200 falls in the second block, so the network is 10.20.130.128. Choosing .0 treats the mask as /24.' },
      { type: 'page', title: 'Subnetting a block', blocks: [
        { type: 'p', text: 'Subnetting borrows host bits to make more, smaller networks. Every bit borrowed doubles the number of subnets and halves the hosts in each. The question is always the same: how many subnets do I need, and how many hosts must the biggest one hold?' },
        { type: 'list', items: [
            'Subnets = 2ⁿ where n is the number of bits borrowed.',
            'Usable hosts per subnet = 2ʰ − 2 where h is the host bits remaining.',
            'Block size in the interesting octet = 256 − the mask value in that octet.',
          ] },
      ] },
      { type: 'page', title: 'Worked example: 1,000-host subnets', blocks: [
        { type: 'example', title: 'Worked example — split 172.16.0.0/16 into subnets of at least 1,000 hosts', steps: [
            '1,000 hosts needs h host bits with 2ʰ − 2 ≥ 1000. 2¹⁰ = 1024, so h = 10.',
            '32 − 10 = 22, so the prefix is /22. Mask = 255.255.252.0.',
            'Bits borrowed from the /16: 6. Subnets = 2⁶ = 64.',
            'Block size in the third octet = 256 − 252 = 4. Subnets start at 172.16.0.0, 172.16.4.0, 172.16.8.0 …',
          ], result: '/22 gives 64 subnets of 1,022 usable hosts each, stepping by 4 in the third octet.' },
        { type: 'callout', kind: 'tip', title: 'Where you will meet this again', text: 'Annex B — VLANs and routing. Every VLAN gets its own subnet, and a router only forwards between subnets it can tell apart. Most “the VLAN does not work” faults are an addressing mistake from this lesson.' },
      ] },
      { type: 'check', title: 'Check: choose a prefix', q: 'You need 30 usable hosts per subnet. What is the longest prefix you can use?', answers: [
            { text: '/26', correct: false },
            { text: '/27', correct: true },
            { text: '/28', correct: false },
            { text: '/30', correct: false },
          ], rationale: '30 usable hosts needs 2ʰ − 2 ≥ 30, so h = 5 (30 exactly). 32 − 5 = 27. A /28 leaves 4 host bits, only 14 usable. A /26 works but wastes half the block.' },
      { type: 'page', title: 'Private ranges on a tactical network', blocks: [
        { type: 'p', text: 'Three blocks are reserved for private use and are never routed on the public internet: 10.0.0.0/8, 172.16.0.0/12 and 192.168.0.0/16. Tactical networks use them heavily, which means two units can legitimately have the same addresses — and a mistake in the plan produces a conflict that is hard to find.' },
      ] },
      { type: 'check', title: 'Check: private addresses', q: 'Which of these is a private address?', answers: [
            { text: '172.32.5.1', correct: false },
            { text: '172.20.5.1', correct: true },
            { text: '192.169.5.1', correct: false },
            { text: '11.0.5.1', correct: false },
          ], rationale: '172.16.0.0/12 covers 172.16.0.0 through 172.31.255.255; 172.32 is just outside it. 192.169 is not 192.168. 11.0.0.0 is not 10.0.0.0/8.' },
      { type: 'practice', title: 'Practice set', text: 'Subnetting drills until block sizes are automatic. Not graded.' },
      { type: 'attachments', title: 'Attachments' },
    ],
  },
};

/* Scaffold for lessons not yet authored: honest structure from the POI so
   the page has shape, with a clear "not yet authored" marker. */
function scaffold(lesson, course) {
  const isExam = lesson.kind === 'exam';
  if (isExam) {
    return {
      intro: `Block exam for Annex ${lesson.annex.letter} — ${lesson.annex.title}. Closed book, ${lesson.hours} h. It covers every lesson in the annex.`,
      items: [
        { type: 'page', title: 'What to expect', blocks: [
          { type: 'list', items: [
            'Your instructor posts the room and time on the calendar and in your inbox.',
            'Bring a pencil and your calculator. No phones on the desk.',
            'Your study plan front-loads the weakest topic in this annex the week before.',
          ] },
          { type: 'callout', kind: 'note', title: 'Practice sets are not the exam', text: 'They are how you find out what you would miss on it. Do them before the review session, not after.' },
        ] },
        { type: 'attachments', title: 'Attachments' },
      ],
      scaffold: true,
    };
  }
  return {
    intro: `${lesson.hours} hours of instruction in Annex ${lesson.annex.letter} — ${lesson.annex.title}. The learning objectives come from the POI and are what the practice questions test.`,
    items: [
      { type: 'page', title: 'Objectives', blocks: [
        { type: 'list', items: course.objectives },
        { type: 'callout', kind: 'note', title: 'Not yet authored', text: 'Placeholder wording. Your instructor authors this lesson from the outline.' },
      ] },
      { type: 'practice', title: 'Practice set', text: 'Generated once your instructor approves the outline.' },
      { type: 'attachments', title: 'Attachments' },
    ],
    scaffold: true,
  };
}

export function contentFor(lesson, course) {
  const c = AUTHORED[lesson.id] ? { ...AUTHORED[lesson.id], scaffold: false } : scaffold(lesson, course);
  // Stable per-lesson item ids: <lessonId>#<n>. Progress records point at these.
  return { ...c, items: c.items.map((it, i) => ({ ...it, id: `${lesson.id}#${i + 1}` })) };
}
