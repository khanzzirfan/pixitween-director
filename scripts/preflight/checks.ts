// Owned by S10. The checks the submission preflight runs, in the order it prints them.
import { checkAssetCredits } from './checks/credits';
import { checkDocs, checkOwnerMarkers } from './checks/docs';
import { checkEnv } from './checks/env';
import { checkEngine } from './checks/engine';
import { checkGitProvenance } from './checks/git';
import { checkLicense } from './checks/license';
import { checkReadmeLinks } from './checks/links';
import { checkEngineNeeds } from './checks/needs';
import { checkPrdComplete, checkPrdExpected } from './checks/prd';
import { checkSecrets } from './checks/secrets';
import type { NamedCheck } from './types';

export const ALL_CHECKS: NamedCheck[] = [
  { id: 'license', run: checkLicense },
  { id: 'docs', run: checkDocs },
  { id: 'readme.links', run: (c) => checkReadmeLinks(c) },
  { id: 'owner.markers', run: checkOwnerMarkers },
  { id: 'engine', run: checkEngine },
  { id: 'secrets', run: (c) => checkSecrets(c) },
  { id: 'env', run: checkEnv },
  { id: 'assets.credits', run: checkAssetCredits },
  { id: 'engine.needs', run: checkEngineNeeds },
  { id: 'prd.expected', run: checkPrdExpected },
  { id: 'prd.complete', run: checkPrdComplete },
  { id: 'git.provenance', run: checkGitProvenance },
];
