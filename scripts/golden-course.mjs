/**
 * The banked golden course: content and shapes, no database.
 *
 * The demo's headline beat is the grounded tutor — a cited answer, and an
 * honest refusal when the sources do not cover the question. That beat needs a
 * *persisted* course with approved sources behind it (see courseForTutor in
 * lib/learning/core.js); the mock courses in app/prototype/data.js are screen
 * fixtures with no LearningRecord, so they can never satisfy it. Live
 * generation is a minute of model calls that the venue's network may not
 * survive, which is why docs/gameday/WINPLAN.md keeps a banked course as the
 * floor.
 *
 * So this module holds exactly what a Coursewright run would have produced for
 * these pages, and scripts/seed-golden-course.mjs writes it down the same path
 * an approved generated course takes. Nothing here loosens the grounding gate:
 * the source is real, the citations resolve to persisted passages, and the
 * draft is handed to the same validateCourseDraft the approval route runs.
 *
 * The doctrine below is verbatim TC 3-22.9 (Rifle and Carbine, May 2016, C2),
 * extracted from the publication PDF by the same Quarry parser the PDF upload
 * route uses. `page` is the PDF page the passage came from, which is what the
 * upload path records and what a citation therefore addresses; `printed` is the
 * page number printed on the page, kept so a human can find it in the manual.
 * The only edit is the bullet glyph: the PDF encodes it in the Wingdings
 * private-use area, and it is rendered here as a hyphen. No word is changed.
 */

export const GOLDEN_SOURCE_RECORD_ID = 'schoolcircle-golden-source-tc-3-22-9';
export const GOLDEN_COURSE_RECORD_ID = 'schoolcircle-golden-course-tc-3-22-9';

/** The human-readable Anchor id, stored on Course.sourceId and every citation. */
export const GOLDEN_SOURCE_LABEL = 'TC 3-22.9';

export const GOLDEN_SOURCE_TITLE =
  'TC 3-22.9 Rifle and Carbine — shot process extract';

export const DOCTRINE_PAGES = Object.freeze([
  {
    page: 85,
    printed: '5-3',
    text: `
Employment

FUNCTIONAL ELEMENTS OF THE SHOT PROCESS
5-10. Functional elements of the shot process are the linkage between the Soldier, the
weapon system, the environment, and the target that directly impact the shot process and
ultimately the consistency, accuracy, and precision of the shot. When used
appropriately, they build a greater understanding of any engagement.
5-11. The functional elements are interdependent. A accurate shot, regardless of
weapon system, requires the Soldier to establish, maintain, and sustain —
- Stability – the Soldier stabilizes the weapon to provide a consistent base to
fire from and maintain through the shot process until the recoil pulse has
ceased. This process includes how the Soldier holds the weapon, uses
structures or objects to provide stability, and the Soldier’s posture on the
ground during an engagement.
- Aim – the continuous process of orienting the weapon correctly, aligning the
sights, aligning on the target, and the appropriate lead and elevation (hold)
during a target engagement.
- Control – all the conscious actions of the Soldier before, during, and after
the shot process that the Soldier specifically is in control of. The first of
which is trigger control. This includes whether, when, and how to engage. It
incorporates the Soldier as a function of safety, as well as the ultimate
responsibility of firing the weapon.
- Movement – the process of the Soldier moving during the engagement
process. It includes the Soldier’s ability to move laterally, forward,
diagonally, and in a retrograde manner while maintaining stabilization,
appropriate aim, and control of the weapon.
5-12. These elements define the tactical engagement that require the Soldier to make
adjustments to determine appropriate actions, and compensate for external influences on
their shot process. When all elements are applied to the fullest extent, Soldiers will be
able to rapidly engage targets with the highest level of precision.
5-13. Time, target size, target distance, and the Soldier’s skills and capabilities
determine the amount of effort required of each of the functional elements to minimize
induced errors of the shot.
5-14. Each weapon, tactical situation, and sight system will have preferred techniques
for each step in the shot process and within the functional elements to produce precision
and accuracy in a timely manner. How fast or slow the shooter progresses through the
process is based on target size, target distance, and shooter capability.
5-15. The most complex form of shooting is under combat conditions when the Soldier
is moving, the enemy is moving, under limited visibility conditions. Soldiers and leaders
must continue to refine skills and move training from the simplest shot to the most
complex. Applying the functional elements during the shot process builds a firer’s speed
while maintaining consistency, accuracy, and precision during complex engagements.
5-16. Each of the functional elements and the Soldier actions to consider during the
shot process are described later in this manual.

13 May 2016 TC 3-22.9 5-3`,
  },
  {
    page: 94,
    printed: '6-4',
    text: `
Chapter 6

Figure 6-1. Stock weld
MUSCLE RELAXATION
6-4. Muscle relaxation is the ability of the Soldier to maintain orientation of the
weapon appropriately during the shot process while keeping the major muscle groups
from straining to maintain the weapon syst em’s position. Relaxed muscles contribute to
stability provided by support.
- Strained or fatigued muscles detract from stability.
- As a rule, the more support from the shooter’s bones the less he requires from
his muscles.
- The more skeletal support, the more stable the position, as bones do not
fatigue or strain.
- As a rule, the less muscle support required, the longer the shooter can stay in
position.
NATURAL POINT OF AIM
6-5. The natural point of aim is the point where the barrel naturally orients when the
shooter’s muscles are relaxed and support is achieved. The natural point of aim is built
upon the following principles:
- The closer the natural point of aim is to the target, the less muscle support
required.
- The more stable the position, the more resistant to recoil it is.
- More of the shooter’s body on the ground equals a more stable position.
- More of the shooter’s body on the ground equals less mobility for the shooter.
6-6. When a Soldier aims at a target, the lack of stability creates a wobble area, where
the sights oscillate slightly around and through the point of aim. If the wobble area is
larger than the target, the Soldier requires a steadier position or a refinement to their
position to decrease the size of his wobble area before trigger squeeze.

6-4 TC 3-22.9 13 May 2016`,
  },
  {
    page: 119,
    printed: '7-1',
    text: `
Chapter 7

Aim

The functional element aim of the shot process is the continuous
process of orienting the weapon correctly, aligning the sights,
aligning on the target, and the application of the appropriate lead
and elevation during a target engagement. Aiming is a continuous
process conducted through pre-shot, shot, and post-shot, to
effectively apply lethal fires in a responsible manner with accuracy
and precision.

Aiming is the application of perfectly aligned sights on a specific
part of a target. Sight alignment is the first and most important part
of this process.
COMMON ENGAGEMENTS
7-1. The aiming process for engaging stationary targets consist of the following
Soldier actions, regardless of the optic, sight, or magnification used by the aiming
device:
- Weapon orientation – the direction of the weapon as it is held in a stabilized
manner.
- Sight alignment – the physical alignment of the aiming device:
- Iron sight/back-up iron sight and the front sight post.
- Optic reticle.
- Ballistic reticle (day or thermal).
- Sight picture – the target as viewed through the line of sight.
- Point of aim (POA) – the specific location where the line of sight intersects
the target.
- Desired point of impact (POI) – the desired location of the strike of the
round to achieve the desired outcome (incapacitation or lethal strike).
7-2. The aim of the weapon is typically applied to the largest, most lethal area of any
target presented. Sights can be placed on target by using battlesight zero (BZ), center of
visible mass (CoVM) . The center of visible mass is the initial point of aim on a target of
what can be seen by the Soldier. It does not include what the target size is expected or
anticipated to be. For example, a target located behind a car exposes its head. The center
of visible mass is in the center of the head, not the estimated location of the center of the
overall target behind the car.

13 May 2016 TC 3-22.9 7-1`,
  },
  {
    page: 121,
    printed: '7-3',
    text: `
Aim

- Vertical weapons orientation includes all the aspects of orienting the
weapon at a potential or confirmed threat in elevation. This is most
commonly applied in restricted, mountainous, or urban terrain where threats
present themselves in elevated or depressed firing positions (see figure 7-2).

Figure 7-2. Vertical weapons orientation example
S IGHT A LIGNMENT
7-4. Sight alignment is the relationship between the aiming device and the firer’s eye.
The process used by a Soldier depends on the aiming device employed with the weapon.
- Iron sight – the relationship between the front sight post, rear sight aperture,
and the firer’s eye. The firer aligns the tip of the front sight post in the center
of the rear aperture and his/or her eye. The firer will maintain focus on the
front sight post, simultaneously centering it in the rear aperture.
- Optics – the relationship between the reticle and the firer’s eye and includes
the appropriate eye relief, or distance of the Soldier’s eye from the optic
itself. Ensure the red dot is visible in the CCO, or a full centered field of view
is achieved with no shadow on magnified optics
- Thermal – the relationship between the firer’s eye, the eyepiece, and the
reticle.
- Pointers / Illuminators / Lasers – the relationship between the firer’s eye,
the night vision device placement and focus, and the laser aiming point on
the target.

13 May 2016 TC 3-22.9 7-3`,
  },
  {
    page: 123,
    printed: '7-5',
    text: `
Aim

S IGHT P ICTURE
7-7. The sight picture is the placement of the aligned sights on the target itself. The
Soldier must maintain sight alignment throughout the positioning of the sights. This is
not the same as sight alignment.
7-8. There are two sight pictures used during the shot process; pre-shot and post-shot.
Soldiers must remember the sight pictures of the shot to complete the overall shot
process.
- Pre-shot sight picture – encompasses the original point of aim, sight picture,
and any holds for target or environmental conditions.
- Post-shot sight picture – is what the Soldier must use as the point of reference
for any sight adjustments for any subsequent shot.
P OINT OF A IM
7-9. The point on the target that is the continuation of the line created by sight
alignment. The point of aim is a point of reference used to calculate any hold the Soldier
deems necessary to achieve the desired results of the round’s impact.
7-10. For engagements against stationary targets, under 300 meters, with negligible
wind, and a weapon that has a 200 meter or 300 meter confirmed zero, the point of aim
should be the center of visible mass of the target. The point of aim does not include
ANY hold-off or lead changes necessary.
D ESIRED P OINT OF I MPACT
7-11. The desired point of impact is the location where the Soldier wants the projectile
to strike the target. Typically, this is the center of visible mass. At any range different
from the weapon’s zero distance, the Soldier’s desired point of impact and their point of
aim will not align. This requires the Soldier to determine the necessary hold-off to
achieve the desired point of impact.
COMMON AIMING ERRORS
7-12. Orienting and aiming a weapon correctly is a practiced skill. Through drills and
repetitions, Soldiers build the ability to repeat proper weapons orientation, sight
alignment, and sight picture as a function of muscle memory.
7-13. The most common aiming errors include:
- Non-dominant eye use – The Soldier gets the greatest amount of visual input
from their dominant eye. Eye dominance varies Soldier to Soldier. Some
Soldier’s dominant eye will be the opposite of the dominant hand. For
example, a Soldier who writes with his right hand and learns to shoot rifles
right handed might learn that his dominant eye is the left eye. This is called
cross-dominant. Soldiers with strong cross-dominant eyes should consider
firing using their dominant eye side while firing from their non-dominant
hand side. Soldiers can be trained to fire from either side of the weapon, but
may not be able to shoot effectively using their nondominant eye.

13 May 2016 TC 3-22.9 7-5`,
  },
  {
    page: 140,
    printed: '8-2',
    text: `
Chapter 8

Figure 8-1. Arc of movement example
8-3. The control element consists of several supporting Soldier functions, and include
all the actions to minimize the Soldier’s induced arc of movement. Executed correctly,
it provides for the best engagement window of opportunity to the firer. The Soldier
physically maintains positive control of the shot process by managing —
- Trigger control.
- Breathing control.
- Workspace.
- Calling the shot (firing or shot execution).
- Follow-through.
TRIGGER CONTROL
8-4. Trigger control is the act of firing the weapon while maintaining proper aim and
adequate stabilization until the bullet leaves the muzzle. Trigger control and the
shooter’s position w ork together to allow the sights to stay on the target long enough for
the shooter to fire the weapon and bullet to exit the barrel.
8-5. Stability and trigger control complement each other and are integrated during the
shot process. A stable position assists in aiming and reduces unwanted movements
during trigger squeeze without inducing unnecessary movement or disturbing the sight
picture. A smooth, consistent trigger squeeze, regardless of speed, allows the shot to fire
at the Soldier ’ s moment of choosing. When both a solid position and a good trigger
squeeze are achieved, any induced shooting errors can be attributed to the aiming
process for refinement.
8-6. Smooth trigger control is facilitated by placing the finger where it naturally lays
on the trigger. Natural placement of the finger on the trigger will allow for the best
mechanical advantage when applying rearward pressure to the trigger.

8-2 TC 3-22.9, C1 10 January 2017`,
  },
  {
    page: 145,
    printed: '8-7',
    text: `
Control

FOLLOW-THROUGH
8-23. Follow-through is the continued mental and physical application of the functional
elements of the shot process after the shot has been fired. The firer’s head stays in contact
with the stock, the firing eye remains open, the trigger finger holds the trigger back
through recoil and then lets off enough to reset the trigger, and the body position and
breathing remain steady.
8-24. Follow-through consists of all actions controlled by the shooter after the bullet
leaves the muzzle. It is required to complete the shot process. These actions are executed
in a general sequence:
- Recoil management. This includes the bolt carrier group recoiling
completely and returning to battery.
- Recoil recovery. Returning to the same pre-shot position and reacquiring the
sight picture. The shooter should have a good sight picture before and after
the shot.
- Trigger/Sear reset. Once the ejection phase of the cycle of function is
complete, the weapon initiates and completes the cocking phase. As part of
the cocking phase, all mechanical components associated with the trigger,
disconnect, and sear are reset. Any failures in the cocking phase indicate a
weapon malfunction and require the shooter to take the appropriate action.
The shooter maintains trigger finger placement and releases pressure on the
trigger until the sear is reset, demonstrated by a metallic click. At this point
the sear is reset and the trigger pre-staged for a subsequent or supplemental
engagement if needed.
- Sight picture adjustment. Counteracting the physical changes in the sight
picture caused by recoil impulses and returning the sight picture onto the
target aiming point.
- Engagement assessment. Once the sight picture returns to the original point
of aim, the firer confirms the strike of the round, assesses the target’s state,
and immediately selects one of the following courses of action:
- Subsequent engagement. The target requires additional (subsequent)
rounds to achieve the desired target effect. The shooter starts the pre-
shot process.
- Supplemental engagement. The shooter determines the desired target
effect is achieved and another target may require servicing. The shooter
starts the pre-shot process.
- Sector check. All threats have been adequately serviced to the desired
effect. The shooter then checks his sector of responsibility for additional
threats as the tactical situation dictates . The unit’s SOP will dictate any
vocal announcements required during the post-shot sequence.
- Correct Malfunction. If the firer determines during the follow-through
that the weapon failed during one of the phases of the cycle of function,
they make the appropriate announcement to their team and immediately
execute corrective action.

13 May 2016 TC 3-22.9 8-7`,
  },
].map((page) => Object.freeze({ ...page, text: page.text.trim() })));

/** Ingestion input for lib/arsenal-core.js `ingestSource`. */
export function goldenSourceInput() {
  return {
    title: GOLDEN_SOURCE_TITLE,
    sourceId: GOLDEN_SOURCE_LABEL,
    text: DOCTRINE_PAGES.map((page) => page.text).join('\n\n'),
    pages: DOCTRINE_PAGES.map((page) => ({ page: page.page, text: page.text })),
  };
}

/* A section cite is "<source record id> p.<page>" — the shape sourcePassages in
   lib/learning/core.js gives Coursewright, and the shape project-course.js
   parses the page out of. The record id, not the publication label, is the
   authenticated key that lets the citation open the page it came from. */
function cite(sourceRecordId, page) {
  return `${sourceRecordId} p.${page}`;
}

/* One teaching point per objective, in the doctrine's own words, so the course
   states what it covers without promising anything these seven pages do not. */
const OBJECTIVES = Object.freeze([
  'Identify the functional elements of the shot process',
  'Explain why the functional elements are interdependent',
  'Define natural point of aim and the role of muscle relaxation',
  'Describe aiming as a continuous process through pre-shot, shot, and post-shot',
  'Define sight alignment',
  'Distinguish sight picture, point of aim, and desired point of impact',
  'Define trigger control',
  'Define follow-through and sequence its actions',
]);

/* Each section names one page and teaches only what that page supports. The
   pairing in section 3 is deliberate: the manual says the aiming process runs
   through three phases, so "four phases" is the question the tutor should
   refuse rather than accommodate. */
const SECTIONS = Object.freeze([
  Object.freeze({
    page: 85,
    title: 'Functional Elements of the Shot Process',
    lesson:
      'Functional elements of the shot process are the linkage between the Soldier, the weapon system, the environment, and the target that directly impact the shot process and ultimately the consistency, accuracy, and precision of the shot. The functional elements are interdependent: an accurate shot, regardless of weapon system, requires the Soldier to establish, maintain, and sustain stability, aim, control, and movement.',
    pre: [
      {
        stem: 'Which functional elements must a Soldier establish, maintain, and sustain during the shot process?',
        options: [
          'Stability, aim, control, and movement',
          'Stance, breathing, grip, and recovery',
          'Zero, hold, lead, and elevation',
          'Load, orient, fire, and assess',
        ],
        answer: 0,
        rationale:
          'The functional elements are stability, aim, control, and movement; an accurate shot requires the Soldier to establish, maintain, and sustain all four.',
      },
      {
        stem: 'What do the functional elements of the shot process describe?',
        options: [
          'The linkage between the Soldier, the weapon system, the environment, and the target',
          'The mechanical cycle of function of the weapon',
          'The sequence of range commands used during qualification',
          'The maintenance schedule for the weapon system',
        ],
        answer: 0,
        rationale:
          'Functional elements are the linkage between the Soldier, the weapon system, the environment, and the target that directly impact the consistency, accuracy, and precision of the shot.',
      },
    ],
    post: [
      {
        stem: 'What determines the amount of effort each functional element requires?',
        options: [
          'Time, target size, target distance, and the Soldier’s skills and capabilities',
          'The ammunition lot and the weapon’s serial number',
          'The unit standard operating procedure alone',
          'The Soldier’s height and weight',
        ],
        answer: 0,
        rationale:
          'Time, target size, target distance, and the Soldier’s skills and capabilities determine the amount of effort required of each of the functional elements to minimize induced errors of the shot.',
      },
      {
        stem: 'Which element of control does the manual name first?',
        options: [
          'Trigger control',
          'Movement',
          'Stability',
          'Weapon orientation',
        ],
        answer: 0,
        rationale:
          'Control is all the conscious actions of the Soldier before, during, and after the shot process; the first of these is trigger control.',
      },
    ],
  }),
  Object.freeze({
    page: 94,
    title: 'Stability — Muscle Relaxation and Natural Point of Aim',
    lesson:
      'The natural point of aim is the point where the barrel naturally orients when the shooter’s muscles are relaxed and support is achieved. The closer the natural point of aim is to the target, the less muscle support required, and the more stable the position, the more resistant to recoil it is. Muscle relaxation keeps the major muscle groups from straining to maintain the weapon system’s position; strained or fatigued muscles detract from stability.',
    pre: [
      {
        stem: 'The natural point of aim is the point where the barrel naturally orients when the shooter’s muscles are:',
        options: [
          'Relaxed and support is achieved',
          'Locked and the sling is tightened',
          'Strained against the weapon’s weight',
          'Braced against the recoil pulse',
        ],
        answer: 0,
        rationale:
          'The natural point of aim is where the barrel naturally orients when the shooter’s muscles are relaxed and support is achieved.',
      },
      {
        stem: 'As a rule, what happens as the shooter takes more support from his bones?',
        options: [
          'He requires less support from his muscles',
          'He requires more support from his muscles',
          'His wobble area increases',
          'His natural point of aim moves off the target',
        ],
        answer: 0,
        rationale:
          'As a rule, the more support from the shooter’s bones the less he requires from his muscles, and bones do not fatigue or strain.',
      },
    ],
    post: [
      {
        stem: 'What is the wobble area?',
        options: [
          'The area where the sights oscillate slightly around and through the point of aim',
          'The spread of a shot group on the target',
          'The arc the muzzle travels during recoil',
          'The zone between the front sight post and the rear aperture',
        ],
        answer: 0,
        rationale:
          'When a Soldier aims at a target, the lack of stability creates a wobble area, where the sights oscillate slightly around and through the point of aim.',
      },
      {
        stem: 'A Soldier’s wobble area is larger than the target. What does the manual require before trigger squeeze?',
        options: [
          'A steadier position, or a refinement to the position to decrease the wobble area',
          'A faster trigger squeeze to beat the movement',
          'A change of aiming device',
          'A new zero at the next available range',
        ],
        answer: 0,
        rationale:
          'If the wobble area is larger than the target, the Soldier requires a steadier position or a refinement to their position to decrease the size of his wobble area before trigger squeeze.',
      },
    ],
  }),
  Object.freeze({
    page: 119,
    title: 'Aim — a Continuous Process',
    lesson:
      'The functional element aim is the continuous process of orienting the weapon correctly, aligning the sights, aligning on the target, and the application of the appropriate lead and elevation during a target engagement. Aiming is a continuous process conducted through pre-shot, shot, and post-shot. Sight alignment is the first and most important part of this process.',
    pre: [
      {
        stem: 'Aiming is a continuous process conducted through which phases?',
        options: [
          'Pre-shot, shot, and post-shot',
          'Pre-shot, shot, recoil, and post-shot',
          'Orientation, alignment, squeeze, follow-through, and assessment',
          'Shot and post-shot',
        ],
        answer: 0,
        rationale:
          'Aiming is a continuous process conducted through pre-shot, shot, and post-shot — three phases.',
      },
      {
        stem: 'Which Soldier action does the aiming process begin with, regardless of the aiming device used?',
        options: [
          'Weapon orientation — the direction of the weapon as it is held in a stabilized manner',
          'Desired point of impact',
          'Sight picture',
          'Point of aim',
        ],
        answer: 0,
        rationale:
          'The aiming process for engaging stationary targets consists of weapon orientation, sight alignment, sight picture, point of aim, and desired point of impact, in that order.',
      },
    ],
    post: [
      {
        stem: 'Which part of the aiming process does the manual call the first and most important?',
        options: [
          'Sight alignment',
          'Sight picture',
          'Point of aim',
          'Desired point of impact',
        ],
        answer: 0,
        rationale:
          'Aiming is the application of perfectly aligned sights on a specific part of a target; sight alignment is the first and most important part of this process.',
      },
      {
        stem: 'A target is behind a car and only its head is exposed. Where is the center of visible mass?',
        options: [
          'In the center of the head',
          'At the estimated center of the whole target behind the car',
          'At the top of the car’s roof line',
          'Wherever the ballistic reticle first settles',
        ],
        answer: 0,
        rationale:
          'The center of visible mass is the initial point of aim on a target of what can be seen by the Soldier; it does not include what the target size is expected or anticipated to be.',
      },
    ],
  }),
  Object.freeze({
    page: 121,
    title: 'Sight Alignment',
    lesson:
      'Sight alignment is the relationship between the aiming device and the firer’s eye. With an iron sight it is the relationship between the front sight post, rear sight aperture, and the firer’s eye: the firer aligns the tip of the front sight post in the center of the rear aperture and his or her eye, and maintains focus on the front sight post while centering it in the rear aperture. With optics it is the relationship between the reticle and the firer’s eye, including the appropriate eye relief.',
    pre: [
      {
        stem: 'Sight alignment is the relationship between:',
        options: [
          'The aiming device and the firer’s eye',
          'The aligned sights and the target',
          'The point of aim and the desired point of impact',
          'The weapon and the supported position',
        ],
        answer: 0,
        rationale:
          'Sight alignment is the relationship between the aiming device and the firer’s eye; the process used depends on the aiming device employed with the weapon.',
      },
      {
        stem: 'Using an iron sight, where does the firer maintain focus?',
        options: [
          'On the front sight post, while centering it in the rear aperture',
          'On the target, while the sights blur',
          'On the rear aperture, while the front sight post blurs',
          'Alternating evenly between the target and the rear aperture',
        ],
        answer: 0,
        rationale:
          'The firer aligns the tip of the front sight post in the center of the rear aperture and his or her eye, and maintains focus on the front sight post, simultaneously centering it in the rear aperture.',
      },
    ],
    post: [
      {
        stem: 'What does sight alignment mean when the Soldier is using an optic?',
        options: [
          'The relationship between the reticle and the firer’s eye, including the appropriate eye relief',
          'The relationship between the aligned sights and the target',
          'The distance between the optic and the front sight post',
          'The elevation hold applied for the range to the target',
        ],
        answer: 0,
        rationale:
          'For optics, sight alignment is the relationship between the reticle and the firer’s eye and includes the appropriate eye relief, or distance of the Soldier’s eye from the optic itself.',
      },
      {
        stem: 'What does sight alignment mean when a pointer, illuminator, or laser is employed?',
        options: [
          'The relationship between the firer’s eye, the night vision device placement and focus, and the laser aiming point on the target',
          'The relationship between the laser and the front sight post only',
          'The relationship between the thermal eyepiece and the reticle',
          'The relationship between the aligned sights and the target',
        ],
        answer: 0,
        rationale:
          'For pointers, illuminators, and lasers, sight alignment is the relationship between the firer’s eye, the night vision device placement and focus, and the laser aiming point on the target.',
      },
    ],
  }),
  Object.freeze({
    page: 123,
    title: 'Sight Picture, Point of Aim, and Desired Point of Impact',
    lesson:
      'The sight picture is the placement of the aligned sights on the target itself, and the Soldier must maintain sight alignment throughout the positioning of the sights — this is not the same as sight alignment. The point of aim is the point on the target that is the continuation of the line created by sight alignment. The desired point of impact is the location where the Soldier wants the projectile to strike the target, typically the center of visible mass.',
    pre: [
      {
        stem: 'The sight picture is:',
        options: [
          'The placement of the aligned sights on the target itself',
          'The relationship between the aiming device and the firer’s eye',
          'The location where the Soldier wants the projectile to strike',
          'The continuation of the line created by sight alignment',
        ],
        answer: 0,
        rationale:
          'The sight picture is the placement of the aligned sights on the target itself; the Soldier must maintain sight alignment throughout the positioning of the sights.',
      },
      {
        stem: 'Which two sight pictures are used during the shot process?',
        options: [
          'Pre-shot and post-shot',
          'Primary and supplemental',
          'Near and far',
          'Iron and optic',
        ],
        answer: 0,
        rationale:
          'There are two sight pictures used during the shot process: pre-shot, which encompasses the original point of aim and any holds, and post-shot, which is the point of reference for any sight adjustments for a subsequent shot.',
      },
    ],
    post: [
      {
        stem: 'The desired point of impact is:',
        options: [
          'The location where the Soldier wants the projectile to strike the target',
          'The point where the line of sight intersects the target',
          'The placement of the aligned sights on the target',
          'The center of the rear aperture',
        ],
        answer: 0,
        rationale:
          'The desired point of impact is the location where the Soldier wants the projectile to strike the target; typically this is the center of visible mass.',
      },
      {
        stem: 'At a range different from the weapon’s zero distance, what does the Soldier have to determine?',
        options: [
          'The necessary hold-off, because point of aim and desired point of impact will not align',
          'Nothing, because point of aim and desired point of impact always align',
          'A new sight picture that ignores the point of aim',
          'A change of aiming device',
        ],
        answer: 0,
        rationale:
          'At any range different from the weapon’s zero distance, the desired point of impact and the point of aim will not align, which requires the Soldier to determine the necessary hold-off.',
      },
    ],
  }),
  Object.freeze({
    page: 140,
    title: 'Control — Trigger Control',
    lesson:
      'Trigger control is the act of firing the weapon while maintaining proper aim and adequate stabilization until the bullet leaves the muzzle. Trigger control and the shooter’s position work together to allow the sights to stay on the target long enough for the shooter to fire the weapon and the bullet to exit the barrel. Smooth trigger control is facilitated by placing the finger where it naturally lays on the trigger.',
    pre: [
      {
        stem: 'Trigger control is maintaining proper aim and adequate stabilization until:',
        options: [
          'The bullet leaves the muzzle',
          'The trigger reaches its rearmost travel',
          'The sear resets',
          'The Soldier calls the shot',
        ],
        answer: 0,
        rationale:
          'Trigger control is the act of firing the weapon while maintaining proper aim and adequate stabilization until the bullet leaves the muzzle.',
      },
      {
        stem: 'Which Soldier functions does the control element consist of?',
        options: [
          'Trigger control, breathing control, workspace, calling the shot, and follow-through',
          'Stability, aim, control, and movement',
          'Weapon orientation, sight alignment, and sight picture',
          'Recoil management, recovery, and reset',
        ],
        answer: 0,
        rationale:
          'The control element consists of trigger control, breathing control, workspace, calling the shot, and follow-through — the actions that minimize the Soldier’s induced arc of movement.',
      },
    ],
    post: [
      {
        stem: 'A Soldier has a solid position and a smooth trigger squeeze but is still missing. Where does the manual send him next?',
        options: [
          'To the aiming process, for refinement',
          'To a new weapon',
          'To a faster trigger squeeze',
          'To a heavier supported position',
        ],
        answer: 0,
        rationale:
          'When both a solid position and a good trigger squeeze are achieved, any induced shooting errors can be attributed to the aiming process for refinement.',
      },
      {
        stem: 'What facilitates smooth trigger control?',
        options: [
          'Placing the finger where it naturally lays on the trigger',
          'Placing the first joint of the finger on the trigger in every case',
          'Squeezing as quickly as the sights allow',
          'Holding the breath for the full engagement',
        ],
        answer: 0,
        rationale:
          'Smooth trigger control is facilitated by placing the finger where it naturally lays on the trigger, which allows the best mechanical advantage when applying rearward pressure.',
      },
    ],
  }),
  Object.freeze({
    page: 145,
    title: 'Control — Follow-Through',
    lesson:
      'Follow-through is the continued mental and physical application of the functional elements of the shot process after the shot has been fired: the firer’s head stays in contact with the stock, the firing eye remains open, the trigger finger holds the trigger back through recoil and then lets off enough to reset the trigger, and the body position and breathing remain steady. Follow-through consists of all actions controlled by the shooter after the bullet leaves the muzzle.',
    pre: [
      {
        stem: 'Follow-through is the continued mental and physical application of the functional elements of the shot process:',
        options: [
          'After the shot has been fired',
          'Before the trigger is staged',
          'Only during recoil recovery',
          'Only when a subsequent engagement is required',
        ],
        answer: 0,
        rationale:
          'Follow-through is the continued mental and physical application of the functional elements of the shot process after the shot has been fired.',
      },
      {
        stem: 'During follow-through, what does the trigger finger do?',
        options: [
          'Holds the trigger back through recoil, then lets off enough to reset the trigger',
          'Comes off the trigger and onto the receiver immediately',
          'Releases fully forward before recoil ends',
          'Applies rearward pressure until the sector check is complete',
        ],
        answer: 0,
        rationale:
          'The trigger finger holds the trigger back through recoil and then lets off enough to reset the trigger, while the head stays in contact with the stock and the firing eye remains open.',
      },
    ],
    post: [
      {
        stem: 'What tells the shooter that the sear has reset?',
        options: [
          'A metallic click as pressure is released until the sear is reset',
          'The bolt carrier group locking to the rear',
          'The sight picture returning to the original point of aim',
          'The ejection of the spent case',
        ],
        answer: 0,
        rationale:
          'The shooter maintains trigger finger placement and releases pressure on the trigger until the sear is reset, demonstrated by a metallic click; the trigger is then pre-staged for a subsequent engagement.',
      },
      {
        stem: 'All threats have been serviced to the desired effect. Which post-shot course of action does the manual name?',
        options: [
          'Sector check — the shooter checks his sector of responsibility for additional threats',
          'Subsequent engagement',
          'Supplemental engagement',
          'Correct malfunction',
        ],
        answer: 0,
        rationale:
          'When all threats have been adequately serviced to the desired effect, the shooter then checks his sector of responsibility for additional threats as the tactical situation dictates.',
      },
    ],
  }),
]);

/* The course-level scenario. Coursewright produces at most one, and
   project-course.js gives it its own trailing section so it is addressable and
   reviewable like every other item. */
const SCENARIO = Object.freeze({
  situation:
    'A Soldier engaging a stationary target under 300 meters reports that his shots are landing consistently off the target even though his position feels solid and his trigger squeeze is smooth. He is firing with an iron sight and has a confirmed 300 meter zero.',
  task:
    'Walk the shot process with him: check that the barrel naturally orients on the target with his muscles relaxed and support achieved, that the tip of the front sight post is centered in the rear aperture with his focus on the front sight post, and that the aligned sights are placed on the center of visible mass. Then confirm that he maintains aim and stabilization until the bullet leaves the muzzle, and that he holds the trigger back through recoil before letting off enough to reset it.',
  coaching:
    'When a solid position and a good trigger squeeze are both achieved, any induced shooting errors can be attributed to the aiming process for refinement. Start with the natural point of aim, because the closer it is to the target the less muscle support is required, and a wobble area larger than the target calls for a steadier position before trigger squeeze.',
});

/**
 * The Coursewright-shaped draft, ready for validateCourseDraft and for the
 * COURSE_DRAFT record payload.
 *
 * @param {{ sourceRecordId?: string }} [options] the persisted SOURCE record id
 *   the citations address. It is a parameter rather than a constant so a test
 *   can build the same draft against a throwaway source.
 */
export function buildGoldenCourseDraft({ sourceRecordId = GOLDEN_SOURCE_RECORD_ID } = {}) {
  if (typeof sourceRecordId !== 'string' || !sourceRecordId.trim()) {
    throw new TypeError('sourceRecordId is required');
  }
  return {
    title: 'Rifle Marksmanship — The Shot Process (TC 3-22.9)',
    objectives: [...OBJECTIVES],
    sections: SECTIONS.map((section) => ({
      title: section.title,
      cite: cite(sourceRecordId, section.page),
      lesson: section.lesson,
      pre: section.pre.map((question) => ({ ...question, options: [...question.options] })),
      post: section.post.map((question) => ({ ...question, options: [...question.options] })),
    })),
    scenario: { ...SCENARIO },
    sourceIds: [sourceRecordId],
  };
}
