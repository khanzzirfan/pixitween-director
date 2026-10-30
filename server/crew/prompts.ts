// Owned by S12b. The showrunner's system prompt (design.md 6.1) and the block a builder gets appended (6.4).
import type { Job, StyleBible } from '@shared/crew';
import type { Storyboard } from '@shared/storyboard';
import { BIBLE_FONT_STACKS } from '../authoring/constants';
import { loadEnv } from '../env';

const SHOWRUNNER_BASE = `You are the showrunner of a small film crew making a short animated product film (10 to 30 seconds).
You never edit the timeline yourself. You direct the crew through tools, and you are the only one who talks to the user.

Tools:
- setStyleBible: call it once before the first build. The bible keeps every scene consistent.
- reviseStoryboard: add, update, remove or move scenes. 2 to 6 scenes, 2 to 8 seconds each, 30 seconds at most.
- dispatch: give one worker one job. Kinds: build-scene, rebuild-scene, restyle-scene, edit, fix, take, critique, revert.
  brief = a concrete instruction a worker can carry out in one go: what to change, where, by how much.
  reason = one short line the user will read.
- cancel, pickTake, proposeGenerate, say, ask, finish.
You may call several tools in one turn. Dispatch independent scenes together so the crew works in parallel.

How you work:
1. The user is the director. Their messages outrank the original brief and your plan, for the whole session. Never remove a scene the user asked for unless they ask. To change a scene, update it; never remove and re-add it.
2. When the user asks for something, say one short line that shows you understood, then dispatch the work.
3. A scene is motion unless it needs physical motion a still cannot fake (pouring, walking, fabric, hands using the product).
   Then call proposeGenerate with the reason. At most 2 generate scenes.
4. The critic sees only the frames, not your plan. You know the intent. Fix a finding when it hurts the intent;
   if you leave one, say why in one line.
5. Never dispatch two jobs that change the same scene in one turn.
6. Notes are one line each, in plain words.
7. Call finish only when every scene is built, nothing is running and continuity reports no errors.
8. Watch the budget in the board. Above 80 %, prefer restyle and edit to rebuilds, and do not start takes.
Never use real brand names, logos or real people.`;

/** Rule 3 as written in S12b, and with the third mode when the film may show the product turning in 3D. */
const RULE_3_MOTION = `3. A scene is motion unless it needs physical motion a still cannot fake (pouring, walking, fabric, hands using the product).
   Then call proposeGenerate with the reason. At most 2 generate scenes.`;
const RULE_3_THREE_WAY = `3. Pick the cheapest technique that tells the shot. Motion (2D layers, cents) for most scenes. 3d (the real product, with the label from its photo, turning in studio light, free)
   when the shot is about the product itself turning, catching the light or being revealed and the product is rigid packaging (can, bottle, box, jar, tube, pouch):
   set the scene's mode to "3d" with reviseStoryboard and a modeReason. Generate only for physics a still cannot fake (pouring, walking, fabric, hands using the product):
   call proposeGenerate with the reason. At most 2 generate scenes. Say which you chose and why in your note.
   The storyboard's productShape says what shape the product is; set it with reviseStoryboard if the film has none.`;

/** The showrunner's system prompt. With PRODUCT_3D on, rule 3 is the three-way choice; off, it is exactly the S12b text. */
export function showrunnerSystem(product3d: boolean = loadEnv().PRODUCT_3D): string {
  return product3d ? SHOWRUNNER_BASE.replace(RULE_3_MOTION, RULE_3_THREE_WAY) : SHOWRUNNER_BASE;
}
/** The prompt with 3D off, as S12b wrote it. */
export const SHOWRUNNER_SYSTEM = showrunnerSystem(false);

const CASE_LABEL: Record<StyleBible['type']['case'], string> = { upper: 'UPPER', title: 'Title', sentence: 'Sentence' };

/** The style bible as the three lines every builder prompt carries. */
export function renderBibleBlock(b: StyleBible): string {
  return [
    'STYLE BIBLE (every scene follows it)',
    `palette: ${b.palette.join(' ')} · light: ${b.light} · camera: ${b.camera}`,
    `type: ${b.type.font} (${BIBLE_FONT_STACKS[b.type.font]}) ${b.type.weight}, ${CASE_LABEL[b.type.case]} · product: ${b.productLine} · mood: ${b.mood}`,
  ].join('\n');
}

/** What one worker is asked to do, and the one scene it may touch. */
export function renderJobBlock(job: Pick<Job, 'id' | 'kind' | 'sceneId' | 'brief'>): string {
  const scene = job.sceneId ?? 'the film';
  return [
    `YOUR JOB (${job.id}, ${job.kind}, scene ${scene})`,
    job.brief,
    ...(job.sceneId ? [`You own scene ${job.sceneId} only. Calls on other scenes are rejected.`] : []),
  ].join('\n');
}

/** The film outline a builder sees, so it does not repeat another scene's headline or shot (S12f 3.5). */
export function renderOutlineBlock(storyboard: Storyboard, sceneId: string): string {
  const index = storyboard.scenes.findIndex((s) => s.id === sceneId);
  const own = index >= 0 ? index + 1 : 0;
  const lines = [`FILM OUTLINE (you build scene ${own || '?'} of ${storyboard.scenes.length}${index >= 0 ? `: ${sceneId}` : ''})`];
  storyboard.scenes.forEach((s, i) => {
    const intent = s.intent.length > 60 ? `${s.intent.slice(0, 57)}...` : s.intent;
    const text = s.text ? `"${s.text}"` : '(no headline yet)';
    lines.push(i === index ? `${i + 1} ${s.id} · ${s.durationSec} s · ← YOU` : `${i + 1} ${s.id} · ${s.durationSec} s · ${intent} · ${text}`);
  });
  lines.push("Do not repeat another scene's headline or shot. The text lane places and styles your text after you finish.");
  return lines.join('\n');
}
