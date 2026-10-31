import { z } from 'zod';

export const IdSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/, 'expected an id starting with a letter, up to 64 characters of letters, digits, _ or -');

export const ColorSchema = z.string().regex(/^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, 'expected #RRGGBB or #RRGGBBAA');

export const SecondsSchema = z.number().finite().min(0);

export const Vec3Schema = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);

const EASE_PATTERN = /^(none|linear|(power[1-4]|sine|expo|circ|back|elastic|bounce|quad|cubic|quart|quint)(\.(in|out|inOut))?)(\([0-9.,\s]*\))?$/;

export const EaseSchema = z.string().regex(EASE_PATTERN, 'expected a GSAP ease such as "power2.inOut" or "back.out(1.7)"').default('power2.inOut');

export const ParamValueSchema = z.union([z.number(), z.string(), z.boolean()]);
