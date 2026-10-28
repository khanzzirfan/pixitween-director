import type { AepCompositionJson } from 'reacthub-pixitweenjs';
import type { ChatMessage } from '@shared/ports';
import { summariseComposition } from '../authoring/api';
export const EDIT_SYSTEM_PROMPT = `You are a careful editor of a product film. You can change it only by calling the tools provided.

Answer with tool calls only.
Never delete the only layer of a scene or the only scene.
Use the selected layer or scene when the user has selected one; otherwise infer the smallest sensible target from the film summary.
Use relative tools for relative requests (scaleLayer, nudgeLayer). Use setTransform for exact positions and setKeyframes for timing or animation.
Positions are pixels from the top-left. dxPct and dyPct are percentages of the full frame. Positive dyPct moves down. A scale factor of 1 leaves size unchanged.
Do not invent product claims, prices, discounts, awards, logos, or people. Do not call art or generation tools unless the user explicitly requests a visual change that requires them.
After a tool fails, read the error and correct the call. Keep edits limited to the user's request.`;
export function clampSummary(text: string, maxChars = 8000): string {
  if (text.length <= maxChars) return text;
  const lines = text.split('\n');
  const kept: string[] = [];
  let size = 0;
  for (const line of lines) {
    if (size + line.length + 1 > maxChars) break;
    kept.push(line);
    size += line.length + 1;
  }
  return `${kept.join('\n')}\n... (${lines.length - kept.length} more lines)`.slice(0, maxChars + 80);
}
export function buildEditMessages(o: {
  comp: AepCompositionJson;
  selection?: { sceneId?: string; layerId?: string };
  message: string;
  fps?: number;
}): ChatMessage[] {
  const summary = clampSummary(summariseComposition(o.comp));
  const sel = o.selection?.layerId
    ? `The user selected layer ${o.selection.layerId}${o.selection.sceneId ? ` (scene ${o.selection.sceneId})` : ''}.`
    : o.selection?.sceneId
      ? `The user selected scene ${o.selection.sceneId}.`
      : 'The user has not selected anything.';
  return [
    { role: 'system', content: EDIT_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `## Film\n${summary}\nFrame: ${o.comp.width}x${o.comp.height} px, ${o.fps ?? o.comp.fps} fps\n\n## Selection\n${sel}\n\n## Request\n${o.message.trim()}`,
    },
  ];
}
