import { z } from 'zod';

// The shot vocabulary (engine/docs/09-camera.md): a shot is declared by film words, not by camera
// numbers. It lives in its own leaf module so the preset parameters can name a shot without the
// schema depending on the layer schemas (which depend on the preset parameters).

export const SHOT_SIZES = ['extremeWide', 'wide', 'medium', 'closeUp', 'extremeCloseUp'] as const;

export const SHOT_ANGLES = ['eye', 'low', 'high', 'overhead'] as const;

export const SHOT_SIDES = ['front', 'left3q', 'right3q', 'leftProfile', 'rightProfile', 'back'] as const;

export const ShotSpecSchema = z
  .object({
    /** The subject the shot frames: `"object:<id>"` or `"objects:<id>,<id>"`. */
    subject: z.string().min(1),
    size: z.enum(SHOT_SIZES),
    angle: z.enum(SHOT_ANGLES).optional(),
    side: z.enum(SHOT_SIDES).optional(),
    fov: z.number().min(10).max(120).optional(),
  })
  .strict();

export type ShotSpec = z.output<typeof ShotSpecSchema>;
