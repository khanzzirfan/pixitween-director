// Owned by S16b. The toy cast's character model and the clips inside it. The Quaternius robot carries all of its motions, so a motion the showrunner asks for is a clip name here, not a file.
/** Which character the fixture forge casts: the original toy character (clips in two files) or the Quaternius robot (all clips inside). */
export const CAST_CHARACTER = 'toy' as 'toy' | 'robot';
export const CHARACTER_SRC = CAST_CHARACTER === 'robot' ? '/cartoon/characters/robot.glb' : '/cartoon/toy-character.glb';
export const ROBOT_CLIPS = ['Idle', 'Walk', 'Run', 'Jump', 'WalkJump', 'Wave', 'Dance', 'ThumbsUp', 'Yes', 'No', 'Punch', 'Sit', 'Stand', 'Death'] as const;

/** Plain words a showrunner uses for a motion, in the order they are tried. */
const ALIASES: Array<[clip: (typeof ROBOT_CLIPS)[number], words: RegExp]> = [
  ['Wave', /wave|hello|greet|hi\b/i],
  ['Dance', /danc|celebrat|boogie|groove|party/i],
  ['Jump', /jump|leap|hop|bounce|spring|bound/i],
  ['Run', /\brun|rush|dash|sprint|race/i],
  ['Walk', /walk|shuffle|stroll|step|approach|enter|cross|wander|trudge|stride/i],
  ['ThumbsUp', /thumb|approv|cheers|drink|sip|toast/i],
  ['Yes', /\byes|nod|agree/i],
  ['No', /\bno\b|shake|refuse|decline/i],
  ['Punch', /punch|hit|smack|strike/i],
  ['Sit', /\bsit|rest|slump/i],
  ['Stand', /stand|rise|get up|wake/i],
  ['Death', /die|faint|collapse|topple/i],
];

/** The robot clip a motion name stands for: its own name when it is one, else the nearest alias, else Idle. */
export function resolveClip(name: string): string {
  const exact = ROBOT_CLIPS.find((c) => c.toLowerCase() === name.trim().toLowerCase());
  if (exact) return exact;
  return ALIASES.find(([, re]) => re.test(name))?.[0] ?? 'Idle';
}
