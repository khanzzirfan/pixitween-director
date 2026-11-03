import { writeFileSync } from 'node:fs';
import { filmFrames } from './lib/film-frames.ts';
const f = await filmFrames({ base: 'http://localhost:5199', file: '/tmp-a.json', times: [0.5, 1.5, 2.6, 3.4, 4.2, 5.0, 6.2, 7.6] });
f.forEach((b, i) => writeFileSync('/private/tmp/claude-501/-Users-irfanahmedkhan-Documents-code-clientcode-trolio-pixitween-director/328b0c30-967c-416f-8f7f-611f9fd43c9b/scratchpad/a-' + i + '.png', b));
