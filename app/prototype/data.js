/* Mock course data for the prototype screens.
   Course STRUCTURE comes from the real parsed POIs in poi.js; the numbers
   here (mastery, missed items, AAR findings) are hand-written demo data. */

const COURSES = {
  'M092721': {
    id: 'M092721',
    school: '28xx — Ground Electronics Maintenance',
    name: 'Basic Electronics Course',
    students: 24,
    week: 6,
    weeks: 14,
    sourceDoc: 'POI_2841_GETR.pdf',
    sourcePages: 148,
    outline: 'Student_Outline_RF_Fundamentals.pdf',
    objectives: [
      'Identify the major components of a transmission line system',
      'Calculate standing wave ratio from forward and reflected power',
      'Apply grounding and bonding standards to a field-expedient installation',
      'Isolate a fault to a line-replaceable unit using a signal-flow approach',
    ],
    references: [
      { tag: 'TM-XXXXX-12', note: 'Operator and organizational maintenance' },
      { tag: 'POI 2841 §4.2', note: 'Transmission line theory' },
      { tag: 'POI 2841 §6.1', note: 'Fault isolation procedures' },
      { tag: 'Safety Annex C', note: 'RF exposure limits' },
    ],
    topics: [
      { name: 'Safety & PPE', mastery: 95 },
      { name: 'Grounding & Bonding', mastery: 91 },
      { name: 'RF Fundamentals', mastery: 88 },
      { name: 'Test Equipment', mastery: 83 },
      { name: 'Antenna Theory', mastery: 76 },
      { name: 'Power Systems', mastery: 71 },
      { name: 'Transmission Lines', mastery: 62 },
      { name: 'Fault Isolation', mastery: 48 },
    ],
    missed: [
      { q: 'Calculate SWR given forward and reflected power', topic: 'Transmission Lines', pct: 71, why: 'Students inverted the ratio' },
      { q: 'Sequence the steps of signal-flow fault isolation', topic: 'Fault Isolation', pct: 66, why: 'Step order not memorized' },
      { q: 'Identify cause of high VSWR at the antenna feed', topic: 'Fault Isolation', pct: 58, why: 'Confused cause with symptom' },
      { q: 'Select correct bonding strap for a field install', topic: 'Grounding & Bonding', pct: 21, why: 'Distractor too similar' },
    ],
    questions: [
      {
        difficulty: 'basic',
        topic: 'Transmission Lines',
        q: 'What does SWR stand for?',
        answers: [
          { text: 'Standing Wave Ratio', correct: true },
          { text: 'Signal Wave Reflection', correct: false },
          { text: 'Static Wave Resistance', correct: false },
          { text: 'Source Wave Regulation', correct: false },
        ],
        rationale:
          'SWR — standing wave ratio — quantifies the ratio of maximum to minimum voltage on a transmission line caused by a mismatch. A perfect match reads 1:1.',
      },
      {
        difficulty: 'basic',
        topic: 'Fault Isolation',
        q: 'Which best describes a signal-flow approach to fault isolation?',
        answers: [
          { text: 'Guessing which component failed based on symptoms alone', correct: false },
          { text: 'Tracing a signal stage by stage until the faulty component is located', correct: true },
          { text: 'Replacing every stage until the fault clears', correct: false },
          { text: 'Testing only the final stage before the antenna', correct: false },
        ],
        rationale:
          'Signal flow means tracing a signal stage by stage to isolate a fault to one component, rather than swapping parts or checking only the last stage.',
      },
      {
        difficulty: 'basic',
        topic: 'Grounding & Bonding',
        q: 'What is bonding, as applied to two equipment racks?',
        answers: [
          { text: 'Joining metallic parts to form a low-impedance electrical path', correct: true },
          { text: 'Insulating the racks from each other', correct: false },
          { text: 'Carrying the primary AC operating current', correct: false },
          { text: 'Grounding the operator rather than the equipment', correct: false },
        ],
        rationale:
          'Bonding joins metallic parts to form a low-impedance electrical path between them, distinct from carrying operating current or physically securing equipment.',
      },
      {
        difficulty: 'standard',
        topic: 'Transmission Lines',
        q: 'Forward power reads 100 W and reflected power reads 4 W. What is the approximate SWR?',
        answers: [
          { text: '1.5 : 1', correct: true },
          { text: '1.09 : 1', correct: false },
          { text: '1.04 : 1', correct: false },
          { text: '25 : 1', correct: false },
        ],
        rationale:
          'Power ratios must be converted to a voltage ratio first. The reflection coefficient is the square root of reflected over forward power: sqrt(4/100) = 0.2. SWR is then (1 + 0.2) / (1 - 0.2) = 1.5 : 1. The most common error is skipping the square root and using the raw power ratio of 0.04, which yields about 1.08 : 1 and understates the mismatch.',
      },
      {
        difficulty: 'standard',
        topic: 'Fault Isolation',
        q: 'A transmitter shows high VSWR immediately after a field antenna install. Which is the most likely CAUSE rather than a symptom?',
        answers: [
          { text: 'The transmitter is folding back power', correct: false },
          { text: 'A damaged or water-intruded coaxial connector', correct: true },
          { text: 'The VSWR meter is reading high', correct: false },
          { text: 'Output power is lower than expected', correct: false },
        ],
        rationale:
          'Power foldback, a high meter reading, and low output are all downstream effects of the impedance mismatch. Only the damaged connector is a physical cause. Distinguishing cause from symptom is the core skill in signal-flow troubleshooting.',
      },
      {
        difficulty: 'standard',
        topic: 'Grounding & Bonding',
        q: 'What is the primary purpose of a bonding strap between two equipment racks?',
        answers: [
          { text: 'To provide a low-impedance path at RF frequencies', correct: true },
          { text: 'To carry primary operating current', correct: false },
          { text: 'To physically secure the racks together', correct: false },
          { text: 'To reduce weight on the ground rod', correct: false },
        ],
        rationale:
          'Bonding equalizes potential and provides a low-impedance path, which matters most at RF where a wire long enough to be a fraction of a wavelength stops behaving like a short. It is not a structural or current-carrying member.',
      },
      {
        difficulty: 'challenge',
        topic: 'Transmission Lines',
        q: 'A line shows a measured return loss of 14 dB. Approximately what is the SWR?',
        answers: [
          { text: '1.5 : 1', correct: true },
          { text: '1.14 : 1', correct: false },
          { text: '2.33 : 1', correct: false },
          { text: '0.2 : 1', correct: false },
        ],
        rationale:
          'Return loss in dB converts to the reflection coefficient via |Γ| = 10^(-RL/20): 10^(-14/20) ≈ 0.2. SWR is then (1 + 0.2) / (1 - 0.2) = 1.5 : 1 — the same mismatch as a 4 W reflected / 100 W forward reading. The common error is treating the dB value itself as a ratio.',
      },
      {
        difficulty: 'challenge',
        topic: 'Fault Isolation',
        q: 'After rough transport handling, a radio shows both low output power AND high VSWR at the same time. What is the most efficient troubleshooting order?',
        answers: [
          { text: 'Assume a shared root cause and check the antenna feed line and connectors first', correct: true },
          { text: 'Replace the transmitter first, since it is the most expensive component', correct: false },
          { text: 'Troubleshoot output power and VSWR as fully unrelated faults, in parallel', correct: false },
          { text: 'Escalate immediately without an operator-level check', correct: false },
        ],
        rationale:
          'A damaged or loosened feedline connector — plausible after rough handling — produces both symptoms at once: it reflects power back (raising VSWR) and reduces power actually reaching the antenna (lowering output). Checking the shared cause first is faster than treating two symptoms as two separate faults.',
      },
      {
        difficulty: 'challenge',
        topic: 'Grounding & Bonding',
        q: 'A bonding strap runs between two racks at a separation close to a quarter-wavelength at the operating HF frequency. What is the risk?',
        answers: [
          { text: 'At that length the strap can present high impedance instead of a low-impedance path, reducing its effectiveness', correct: true },
          { text: 'None — bonding strap length never matters', correct: false },
          { text: 'The strap will overheat from carrying primary operating current', correct: false },
          { text: 'The strap only affects electrical code compliance, not RF performance', correct: false },
        ],
        rationale:
          'A conductor that is a significant fraction of a wavelength stops behaving like a short: at roughly a quarter-wavelength it can present high impedance rather than the low-impedance path bonding is meant to provide. This is why strap length and routing matter at RF, not just conductivity.',
      },
    ],
    aar: [
      {
        sev: 'crit',
        title: 'Fault Isolation is the course bottleneck',
        body: 'Mastery has sat below 55% for three consecutive classes and is the single largest contributor to remediation hours. Class 06-26 spent 4.5 average remediation hours on this block alone.',
        src: 'Sources: assessment data (3 classes), instructor critiques (7), student end-of-course surveys (61)',
        term: 'Long term',
      },
      {
        sev: 'warn',
        title: 'Transmission Lines math is under-taught relative to test weight',
        body: 'The block allocates 2 hours of instruction but carries 6 assessment items. Students who missed the SWR item overwhelmingly reported they had not practiced the calculation before the exam.',
        src: 'Sources: POI hour allocation vs. question bank distribution, 24 student responses',
        term: 'Short term',
      },
      {
        sev: 'warn',
        title: 'One bonding-strap item is functioning as a trick question',
        body: 'Only 21% answered correctly, but the same students scored 91% on the rest of the Grounding block. Two distractors are nearly synonymous. Recommend the item be reviewed rather than the block re-taught.',
        src: 'Sources: item analysis, 3 instructor comments',
        term: 'Short term',
      },
      {
        sev: 'good',
        title: 'Safety block is performing well and can absorb time',
        body: 'Mastery has held above 93% across four classes with no remediation. Candidate to compress by one hour and reallocate to Fault Isolation.',
        src: 'Sources: assessment data (4 classes)',
        term: 'Long term',
      },
    ],
    trend: [52, 55, 51, 54, 48],
  },

  'M09CVS1': {
    id: 'M09CVS1',
    school: '06xx — Communications (MOS 0631)',
    name: 'Network Administrator Course',
    students: 31,
    week: 3,
    weeks: 9,
    sourceDoc: 'POI_0621_TRO.pdf',
    sourcePages: 96,
    outline: 'Student_Outline_Net_Operations.pdf',
    objectives: [
      'Establish a single-channel radio net using assigned frequencies',
      'Apply prowords and correct voice procedure in net traffic',
      'Perform operator-level preventive maintenance checks',
      'Troubleshoot a no-communications condition to the operator level',
    ],
    references: [
      { tag: 'POI 0621 §2.3', note: 'Voice procedure' },
      { tag: 'POI 0621 §5.4', note: 'Antenna selection' },
      { tag: 'TM-XXXXX-10', note: 'Operator manual' },
      { tag: 'Safety Annex B', note: 'Vehicle antenna clearance' },
    ],
    topics: [
      { name: 'Voice Procedure', mastery: 93 },
      { name: 'Net Entry', mastery: 87 },
      { name: 'PMCS', mastery: 84 },
      { name: 'Frequency Management', mastery: 74 },
      { name: 'Antenna Selection', mastery: 69 },
      { name: 'COMSEC Handling', mastery: 66 },
      { name: 'No-Comms Troubleshooting', mastery: 55 },
    ],
    missed: [
      { q: 'Select the correct antenna for a 40 km ground link', topic: 'Antenna Selection', pct: 64, why: 'Range vs. antenna type not linked' },
      { q: 'Sequence the no-comms troubleshooting checklist', topic: 'No-Comms Troubleshooting', pct: 61, why: 'Steps recalled out of order' },
      { q: 'Identify the correct proword for a message repeat', topic: 'Voice Procedure', pct: 19, why: 'Two prowords commonly confused' },
    ],
    questions: [
      {
        difficulty: 'basic',
        topic: 'Antenna Selection',
        q: 'What is the main advantage of a directional antenna over an omnidirectional one for a fixed point-to-point link?',
        answers: [
          { text: 'It concentrates radiated energy toward the distant station', correct: true },
          { text: 'It requires no maintenance', correct: false },
          { text: 'It only works at VHF', correct: false },
          { text: 'It eliminates the need for line-of-sight', correct: false },
        ],
        rationale:
          'A directional antenna focuses radiated energy toward the distant station and rejects noise off-axis, which is why it is preferred over an omnidirectional antenna for a fixed link.',
      },
      {
        difficulty: 'basic',
        topic: 'No-Comms Troubleshooting',
        q: 'What does PMCS stand for?',
        answers: [
          { text: 'Preventive Maintenance Checks and Services', correct: true },
          { text: 'Primary Mission Communication System', correct: false },
          { text: 'Personnel Monitoring and Control System', correct: false },
          { text: 'Portable Maintenance Certification Standard', correct: false },
        ],
        rationale:
          'PMCS — preventive maintenance checks and services — are the operator-level checks performed on equipment, including the frequency and antenna checks used in no-comms troubleshooting.',
      },
      {
        difficulty: 'basic',
        topic: 'Voice Procedure',
        q: "What does the proword 'ROGER' mean?",
        answers: [
          { text: 'Message received', correct: true },
          { text: 'Received and will comply', correct: false },
          { text: 'Repeat your last transmission', correct: false },
          { text: 'Stop transmitting', correct: false },
        ],
        rationale:
          "ROGER means the message was received. It is often confused with WILCO (received and will comply) or SAY AGAIN (repeat your transmission).",
      },
      {
        difficulty: 'standard',
        topic: 'Antenna Selection',
        q: 'You need a reliable 40 km ground-to-ground link over rolling terrain. Which antenna choice is most appropriate?',
        answers: [
          { text: 'Short whip, vertical', correct: false },
          { text: 'A directional antenna oriented on the distant station', correct: true },
          { text: 'The shortest antenna available, to reduce signature', correct: false },
          { text: 'Any antenna — range depends only on output power', correct: false },
        ],
        rationale:
          'Beyond short ranges the antenna pattern matters more than raw output power. A directional antenna concentrates radiated energy toward the distant station and rejects noise off-axis. The last option is the most common misconception: power alone does not overcome a poor pattern or terrain masking.',
      },
      {
        difficulty: 'standard',
        topic: 'No-Comms Troubleshooting',
        q: 'A radio powers on but cannot reach the net. What is the FIRST operator-level check?',
        answers: [
          { text: 'Swap the radio for a replacement set', correct: false },
          { text: 'Verify frequency, and that the antenna is connected and undamaged', correct: true },
          { text: 'Request a new COMSEC fill', correct: false },
          { text: 'Report the set as non-functional', correct: false },
        ],
        rationale:
          'Operator troubleshooting works cheapest-and-most-likely first. Frequency and antenna faults account for the majority of no-comms conditions and cost seconds to check. Swapping sets or escalating before those checks wastes time and equipment.',
      },
      {
        difficulty: 'standard',
        topic: 'Voice Procedure',
        q: 'Which proword directs the receiving station to repeat the entire message back to you?',
        answers: [
          { text: 'SAY AGAIN', correct: false },
          { text: 'READ BACK', correct: true },
          { text: 'ROGER', correct: false },
          { text: 'WILCO', correct: false },
        ],
        rationale:
          'READ BACK directs the receiving station to repeat the message back. SAY AGAIN is a request for the sender to retransmit — the two are frequently swapped. ROGER means received; WILCO means received and will comply.',
      },
      {
        difficulty: 'challenge',
        topic: 'Antenna Selection',
        q: 'A directional antenna link that worked reliably at 25 km now fails at 40 km over the same rolling terrain, with no equipment changes. What is the most likely explanation?',
        answers: [
          { text: 'The path now fails to clear terrain obstructions enough for the link, independent of antenna gain', correct: true },
          { text: 'Output power always dominates over terrain at any range', correct: false },
          { text: 'The antenna gain rating expires past 25 km', correct: false },
          { text: 'The COMSEC fill expired', correct: false },
        ],
        rationale:
          'At the longer range, terrain masking of the path (inadequate clearance over rolling terrain) becomes the limiting factor rather than antenna gain or output power — the same misconception flagged in the standard-tier question, taken further.',
      },
      {
        difficulty: 'challenge',
        topic: 'No-Comms Troubleshooting',
        q: 'Frequency is confirmed correct and the antenna is connected and undamaged, but the radio still cannot reach the net — while a nearby station reports comms are fine. What should the operator check next, before escalating?',
        answers: [
          { text: 'Whether the frequency and settings actually match the net\'s current signal operating instructions (SOI), since a stale fill produces exactly this symptom', correct: true },
          { text: 'Swap the radio immediately', correct: false },
          { text: 'Replace the antenna anyway, despite the check already passing', correct: false },
          { text: 'Report the entire net as down', correct: false },
        ],
        rationale:
          'A working nearby station rules out a net-wide outage. With frequency and antenna already checked, a stale COMSEC/SOI fill is the next most likely operator-level cause — cheaper to check than swapping equipment or escalating.',
      },
      {
        difficulty: 'challenge',
        topic: 'Voice Procedure',
        q: 'A station transmits: "SAY AGAIN, ALL AFTER GRID." What is being requested?',
        answers: [
          { text: 'Repeat only the portion of the message that comes after the word "GRID"', correct: true },
          { text: 'Repeat the entire message', correct: false },
          { text: 'Confirm receipt of the message', correct: false },
          { text: 'End the transmission', correct: false },
        ],
        rationale:
          'SAY AGAIN combined with a fill word like ALL AFTER (or ALL BEFORE) requests a partial retransmission from that point, not the whole message — a refinement most students miss when they only learn the basic SAY AGAIN / READ BACK distinction.',
      },
    ],
    aar: [
      {
        sev: 'crit',
        title: 'No-Comms Troubleshooting is not sticking',
        body: 'Mastery sits at 55% and this block generates the most instructor-flagged remediation. Students recall the checklist items but not the order, which suggests it is being taught as a list rather than as a decision process.',
        src: 'Sources: assessment data (2 classes), instructor critiques (4), 28 student responses',
        term: 'Long term',
      },
      {
        sev: 'warn',
        title: 'SAY AGAIN / READ BACK confusion is systemic, not individual',
        body: '81% of the class missed this item despite 93% mastery of the Voice Procedure block overall. A single targeted 10-minute review would likely close it.',
        src: 'Sources: item analysis, 31 responses',
        term: 'Short term',
      },
      {
        sev: 'good',
        title: 'Voice Procedure block is strong',
        body: 'Consistently above 90% with minimal remediation. No change recommended beyond the single item above.',
        src: 'Sources: assessment data (2 classes)',
        term: 'Short term',
      },
    ],
    trend: [58, 61, 57, 55],
  },
};

const LEADERBOARD = [
  { name: 'Alvarez', score: 2840 },
  { name: 'You', score: 2610, you: true },
  { name: 'Okafor', score: 2455 },
  { name: 'Bui', score: 2380 },
  { name: 'Reyes', score: 1990 },
];

// Ids only — components are resolved at render time inside <Prototype/>.
// React Fast Refresh rewrites component declarations, so a module-level map

export { COURSES, LEADERBOARD };
