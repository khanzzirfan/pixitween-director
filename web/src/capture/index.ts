// Owned by S5b. Review capture: plans the frames, seeks the player, waits for each picture to settle, measures text.
export { planFrames, FRAME_FRACTIONS, CAPTURE_FPS, type PlanItem, type PlanScene } from './plan';
export { fitTransform, toCompSpace, type FitTransform, type Rect, type Size } from './fit';
export { waitForStable, captureFrames, type CaptureDriver, type CapturedFrame, type StableResult } from './stable';
export { measureTextBoxes, findTextNode, type PixiNodeLike, type PixiStageLike } from './measure';
export const STUB_OWNER = 'S5b' as const;
