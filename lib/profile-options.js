/*
 * The profile option lists are deliberately kept independent of the database
 * and the UI.  They are used by both of those boundaries, so the values here
 * are the persisted values (rather than display-only abbreviations).
 */

const option = (value, label = value) => ({ value, label });

export const PROFILE_ROLES = [
  option('LEARNER', 'Student'),
  option('INSTRUCTOR', 'Instructor'),
  option('BOTH', 'Student and instructor'),
];

export const SERVICE_BRANCHES = [
  option('ARMY', 'Army'),
  option('MARINE_CORPS', 'Marine Corps'),
  option('NAVY', 'Navy'),
  option('AIR_FORCE', 'Air Force'),
  option('SPACE_FORCE', 'Space Force'),
  option('COAST_GUARD', 'Coast Guard'),
  option('CIVILIAN', 'Civilian / not serving'),
];

/*
 * These are the standard titles used for each grade.  Some grades have more
 * than one title because the title is a real rank distinction at that grade
 * (for example, Army Specialist/Corporal), rather than because a billet or a
 * senior-advisor assignment is being represented as another rank.
 *
 * Values are intentionally kept to standard titles that fit the existing
 * User.rank VARCHAR(40) column.  In particular, service chiefs and similar
 * senior-advisor assignments are not rank options.
 */
const RANKS = {
  ARMY: {
    'E-1': ['Private'],
    'E-2': ['Private'],
    'E-3': ['Private First Class'],
    'E-4': ['Specialist', 'Corporal'],
    'E-5': ['Sergeant'],
    'E-6': ['Staff Sergeant'],
    'E-7': ['Sergeant First Class'],
    'E-8': ['Master Sergeant', 'First Sergeant'],
    'E-9': ['Sergeant Major', 'Command Sergeant Major'],
    'W-1': ['Warrant Officer 1'],
    'W-2': ['Chief Warrant Officer 2'],
    'W-3': ['Chief Warrant Officer 3'],
    'W-4': ['Chief Warrant Officer 4'],
    'W-5': ['Chief Warrant Officer 5'],
    'O-1': ['Second Lieutenant'],
    'O-2': ['First Lieutenant'],
    'O-3': ['Captain'],
    'O-4': ['Major'],
    'O-5': ['Lieutenant Colonel'],
    'O-6': ['Colonel'],
    'O-7': ['Brigadier General'],
    'O-8': ['Major General'],
    'O-9': ['Lieutenant General'],
    'O-10': ['General'],
  },

  MARINE_CORPS: {
    'E-1': ['Private'],
    'E-2': ['Private First Class'],
    'E-3': ['Lance Corporal'],
    'E-4': ['Corporal'],
    'E-5': ['Sergeant'],
    'E-6': ['Staff Sergeant'],
    'E-7': ['Gunnery Sergeant'],
    'E-8': ['Master Sergeant', 'First Sergeant'],
    'E-9': ['Master Gunnery Sergeant', 'Sergeant Major'],
    'W-1': ['Warrant Officer 1'],
    'W-2': ['Chief Warrant Officer 2'],
    'W-3': ['Chief Warrant Officer 3'],
    'W-4': ['Chief Warrant Officer 4'],
    'W-5': ['Chief Warrant Officer 5'],
    'O-1': ['Second Lieutenant'],
    'O-2': ['First Lieutenant'],
    'O-3': ['Captain'],
    'O-4': ['Major'],
    'O-5': ['Lieutenant Colonel'],
    'O-6': ['Colonel'],
    'O-7': ['Brigadier General'],
    'O-8': ['Major General'],
    'O-9': ['Lieutenant General'],
    'O-10': ['General'],
  },

  NAVY: {
    'E-1': ['Seaman Recruit'],
    'E-2': ['Seaman Apprentice'],
    'E-3': ['Seaman'],
    'E-4': ['Petty Officer Third Class'],
    'E-5': ['Petty Officer Second Class'],
    'E-6': ['Petty Officer First Class'],
    'E-7': ['Chief Petty Officer'],
    'E-8': ['Senior Chief Petty Officer'],
    'E-9': ['Master Chief Petty Officer'],
    'W-2': ['Chief Warrant Officer 2'],
    'W-3': ['Chief Warrant Officer 3'],
    'W-4': ['Chief Warrant Officer 4'],
    'W-5': ['Chief Warrant Officer 5'],
    'O-1': ['Ensign'],
    'O-2': ['Lieutenant Junior Grade'],
    'O-3': ['Lieutenant'],
    'O-4': ['Lieutenant Commander'],
    'O-5': ['Commander'],
    'O-6': ['Captain'],
    'O-7': ['Rear Admiral (Lower Half)'],
    'O-8': ['Rear Admiral (Upper Half)'],
    'O-9': ['Vice Admiral'],
    'O-10': ['Admiral'],
  },

  AIR_FORCE: {
    'E-1': ['Airman Basic'],
    'E-2': ['Airman'],
    'E-3': ['Airman First Class'],
    'E-4': ['Senior Airman'],
    'E-5': ['Staff Sergeant'],
    'E-6': ['Technical Sergeant'],
    'E-7': ['Master Sergeant'],
    'E-8': ['Senior Master Sergeant'],
    'E-9': ['Chief Master Sergeant'],
    // The Air Force reinstated warrant officers; W-1 and W-2 are currently
    // the warrant grades in its program.
    'W-1': ['Warrant Officer 1'],
    'W-2': ['Chief Warrant Officer 2'],
    'O-1': ['Second Lieutenant'],
    'O-2': ['First Lieutenant'],
    'O-3': ['Captain'],
    'O-4': ['Major'],
    'O-5': ['Lieutenant Colonel'],
    'O-6': ['Colonel'],
    'O-7': ['Brigadier General'],
    'O-8': ['Major General'],
    'O-9': ['Lieutenant General'],
    'O-10': ['General'],
  },

  SPACE_FORCE: {
    'E-1': ['Specialist 1'],
    'E-2': ['Specialist 2'],
    'E-3': ['Specialist 3'],
    'E-4': ['Specialist 4'],
    'E-5': ['Sergeant'],
    'E-6': ['Technical Sergeant'],
    'E-7': ['Master Sergeant'],
    'E-8': ['Senior Master Sergeant'],
    'E-9': ['Chief Master Sergeant'],
    'O-1': ['Second Lieutenant'],
    'O-2': ['First Lieutenant'],
    'O-3': ['Captain'],
    'O-4': ['Major'],
    'O-5': ['Lieutenant Colonel'],
    'O-6': ['Colonel'],
    'O-7': ['Brigadier General'],
    'O-8': ['Major General'],
    'O-9': ['Lieutenant General'],
    'O-10': ['General'],
  },

  COAST_GUARD: {
    'E-1': ['Seaman Recruit'],
    'E-2': ['Seaman Apprentice'],
    'E-3': ['Seaman'],
    'E-4': ['Petty Officer Third Class'],
    'E-5': ['Petty Officer Second Class'],
    'E-6': ['Petty Officer First Class'],
    'E-7': ['Chief Petty Officer'],
    'E-8': ['Senior Chief Petty Officer'],
    'E-9': ['Master Chief Petty Officer'],
    'W-2': ['Chief Warrant Officer 2'],
    'W-3': ['Chief Warrant Officer 3'],
    'W-4': ['Chief Warrant Officer 4'],
    'W-5': ['Chief Warrant Officer 5'],
    'O-1': ['Ensign'],
    'O-2': ['Lieutenant Junior Grade'],
    'O-3': ['Lieutenant'],
    'O-4': ['Lieutenant Commander'],
    'O-5': ['Commander'],
    'O-6': ['Captain'],
    'O-7': ['Rear Admiral (Lower Half)'],
    'O-8': ['Rear Admiral (Upper Half)'],
    'O-9': ['Vice Admiral'],
    'O-10': ['Admiral'],
  },
};

const SUPPORTED_ROLES = new Set(PROFILE_ROLES.map(({ value }) => value));
const SUPPORTED_BRANCHES = new Set(SERVICE_BRANCHES.map(({ value }) => value));

function optionsFor(values) {
  return values ? values.map((value) => option(value)) : [];
}

export function getPayGrades(branch) {
  if (!SUPPORTED_BRANCHES.has(branch) || branch === 'CIVILIAN') return [];
  return optionsFor(Object.keys(RANKS[branch]));
}

export function getRanks(branch, payGrade) {
  if (!SUPPORTED_BRANCHES.has(branch) || branch === 'CIVILIAN') return [];
  return optionsFor(RANKS[branch][payGrade]);
}

function hasValidCompletionDate(value) {
  if (!value) return false;
  if (value instanceof Date) return !Number.isNaN(value.getTime());
  if (typeof value === 'string') {
    return value.trim() !== '' && !Number.isNaN(Date.parse(value));
  }
  return false;
}

function isEmptyChoice(value) {
  return value === null ||
    (typeof value === 'string' && value.trim() === '');
}

export function isProfileComplete(profile) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return false;
  if (!hasValidCompletionDate(profile.profileCompletedAt)) return false;
  if (typeof profile.name !== 'string' || profile.name.trim() === '') return false;
  if (!SUPPORTED_ROLES.has(profile.role) || !SUPPORTED_BRANCHES.has(profile.branch)) {
    return false;
  }

  if (profile.branch === 'CIVILIAN') {
    return isEmptyChoice(profile.payGrade) && isEmptyChoice(profile.rank);
  }

  if (typeof profile.payGrade !== 'string' || typeof profile.rank !== 'string') {
    return false;
  }
  return RANKS[profile.branch][profile.payGrade]?.includes(profile.rank) || false;
}