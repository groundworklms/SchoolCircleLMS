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
