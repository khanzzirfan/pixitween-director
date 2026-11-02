// A line-up: a catalogue made the way one film is made. Every product is its own crew film (the same showrunner,
// builders and critic), and the films run one after another. The line-up only remembers the order and who is where.
import { z } from 'zod';
import { productSchema } from './catalog';

/** The longest brief a line-up keeps, in characters. */
export const BRIEF_MAX = 600;

export const LINEUP_ID_RE = /^lin_[a-z0-9]{8,32}$/;
export const newLineupId = (): string => `lin_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;

/** Where a product is in the line-up. `waiting` films exist already but have not started. `stopped` means the owner ended the catalogue. */
export const ITEM_STATES = ['waiting', 'making', 'done', 'failed', 'stopped'] as const;
export type ItemState = (typeof ITEM_STATES)[number];

export const lineupItemSchema = z.object({
  product: productSchema,
  /** the product's own film; missing when its photo could not be found */
  filmId: z.string().optional(),
  state: z.enum(ITEM_STATES),
  error: z.string().optional(),
});
export type LineupItem = z.infer<typeof lineupItemSchema>;

export const lineupSchema = z.object({
  id: z.string().regex(LINEUP_ID_RE),
  aspect: z.enum(['9:16', '16:9', '1:1']),
  createdAt: z.string(),
  /** the owner's words for the whole line-up, given to every film */
  brief: z.string().max(BRIEF_MAX).default(''),
  items: z.array(lineupItemSchema).min(1),
});
export type Lineup = z.infer<typeof lineupSchema>;

/** The product being made now, else the next one waiting. */
export const currentItem = (l: Lineup): LineupItem | undefined => l.items.find((i) => i.state === 'making') ?? l.items.find((i) => i.state === 'waiting');
