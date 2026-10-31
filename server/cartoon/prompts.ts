// Owned by S16b. The blocking worker's system prompt: the rules of a toy-studio shot, in the order the tools are used.
import type { Scene } from '@shared/storyboard';

/** The 3 x 3 grid every actor and prop stands on: metres from the centre of the stage. */
export const GRID_X = [-1.5, 0, 1.5] as const;
export const GRID_Z = [-1, 0, 1] as const;

/** The toy-studio section of the showrunner's prompt (added when CARTOON_MODE is on). */
export const TOY_STUDIO_SECTION = `TOY STUDIO. This film is a 3D toy cartoon: toon-shaded characters in a small set under one light. There is a locked camera: it never moves. The motion comes from the characters and the light.
Extra tools: castCharacter, dressSet, requestMotion, blockShot, lightCue. Work in this order:
1. setStyleBible, then reviseStoryboard with the scenes. Give each scene beats (what happens), castIds (the ids castCharacter returned), cues ([{ atSec, actorId, clip }] with a clip you asked requestMotion for) and a lightCue.
2. In one turn, in parallel: castCharacter for every character (3 actors at most on a stage), dressSet once per place the film visits (each gets its own painted backdrop) and up to 4 props, requestMotion for every clip a cue uses.
3. When the board shows them done, blockShot every scene in one turn. blockShot says which cast member, prop or motion is not ready yet: wait for it, do not retry at once.
4. Then review: critique each scene, fix what hurts the story, and finish.
Make it cinematic: plan 5 to 7 shots that open wide, cut closer as the story builds, use a low or over-the-shoulder angle for the big moment, and change place at least once. Do not use build-scene for a toy-studio scene and do not ask for camera moves.`;

export function blockShotPrompt(o: { scene: Scene; toolNames: string[]; clips: string[]; assets: { actors: string[]; props: string[]; sets: string[] }; fps: number }): string {
  const { scene } = o;
  const cues = scene.cues?.length ? scene.cues.map((c) => `- at ${c.atSec}s ${c.actorId}: ${c.clip}${c.mark ? ` to mark [${c.mark.join(', ')}]` : ''}`).join('\n') : '- none: invent a few that fit the beats';
  return [
    `You block ONE shot of a toy-studio cartoon: scene "${scene.id}", ${scene.durationSec} s at ${o.fps} fps. You may only touch this scene.`,
    `Beats: ${scene.beats ?? scene.intent}`,
    `Cast ids: ${(scene.castIds ?? []).join(', ') || 'none named'}. Light cue: ${scene.lightCue ?? 'studio'}.`,
    `Cues from the storyboard:\n${cues}`,
    '',
    'Rules:',
    `1. Call addStage first (sceneId "${scene.id}"${o.assets.sets[0] ? `, backdropAssetId: pick the set that fits the beats from: ${o.assets.sets.join('; ')}` : ''}). Pass shot: the framing of this shot, one of wide (the whole room), medium, close (one character, keep x at 0), low (heroic, looking up), high (looking down), over (three-quarter angle). Vary the shot from the scene before it. The camera is LOCKED: never ask for a camera move. The motion comes from the characters and the light.`,
    `2. Stand actors and props on the grid: x in {${GRID_X.join(', ')}}, z in {${GRID_Z.join(', ')}}. A mark is [x, z, facingDeg]; facing 0 looks at the camera, 90 looks left of frame.`,
    '3. The product is never covered by an actor: keep it at a different x from every actor, or hold it in a hand with attach.',
    '2b. One thing per mark: never put an actor and a prop (or two props) on the same [x, z]. Use a different cell for each, so nothing stands on or inside another.',
    '3b. Always pass size for a prop. Furniture (bed, counter, table, chair, window) is 0.7 to 1.1 m; small things (can, mug, lamp, clock, books, plant, ball) are 0.2 to 0.4 m; a rug is 0.9 m. Put props beside the characters (a different x), never in front of one.',
    `4. A clip must exist. Use only these clip names or ids: ${o.clips.join(', ') || '(none registered: use Idle only)'}. If a call fails because a clip does not exist, read the error, pick one from the list and call again.`,
    `5. Keep cues at least 0.2 s apart. Times are in seconds. A walk needs both cueClip (a walk clip) and moveActor (the mark).`,
    `6. Character assets (actorId, then the assetId to pass to placeActor): ${o.assets.actors.join(', ') || 'none'}. Prop assets: ${o.assets.props.join(', ') || 'none (use shapes)'}.`,
    `7. Finish with setLightCue for the shot. The title and captions are already in the scene: change their words with setText only if the beats ask.`,
    `Tools you have: ${o.toolNames.join(', ')}. Answer with tool calls only; stop when the shot is blocked.`,
  ].join('\n');
}
