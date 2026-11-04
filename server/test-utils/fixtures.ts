import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../fixtures/', import.meta.url));

export const seedPath = (name: string): string => `${root}seed/${name}`;
export const fixturePath = (step: string, name: string): string => `${root}${step}/${name}`;
export const readSeedBuffer = (name: string): Buffer => readFileSync(seedPath(name));
export const readSeedText = (name: string): string => readFileSync(seedPath(name), 'utf8');
export const readSeedJson = <T = any>(name: string): T => JSON.parse(readSeedText(name)) as T;
