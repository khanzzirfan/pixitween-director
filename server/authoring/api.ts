// Owned by S3a (PRD prd-s03a-authoring-core). The authoring API of contract 06 section 4a plus a few additive extras.
// All functions are pure: they return a NEW composition and throw AuthoringError on bad input.
export const STUB_OWNER = 'S3a' as const;

export { secToFrames, framesToSec } from './units';
export { newFilmComposition, registerAsset, setAssetSrc } from './composition';
export { addScene, setSceneDuration, swapScenes, removeScene } from './scenes';
export { addLayer, removeLayer, reorderLayer, setLayerHidden, setText } from './layers';
export { setTransform, setKeyframes } from './transform';
export { setCamera, applyCameraIfSet } from './camera';
export { sceneInfo, layerInfo, layerIdsByRole, markPlaceholder } from './read';
export { summariseComposition } from './summarise';
export { setProductNoun, getProductNoun } from './meta';
export { AuthoringError } from './errors';
export type { Aspect, LayerRole, Prop, Ease, CameraMove, StyleArg, Comp } from './types';
