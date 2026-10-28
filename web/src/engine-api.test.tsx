import * as React from 'react';
import { render } from '@testing-library/react';
import { expect, it } from 'vitest';
import {
  AepComposition,
  GsapPixieContext,
  GsapPixieContextProvider,
  PixiSequenceWrapper,
  aepCompositionSchema,
  parseAepComposition,
  parseAepCompositionSafe,
  type AepCompositionJson,
} from 'reacthub-pixitweenjs';

it('exports the public pieces the Player needs', () => {
  const comp: AepCompositionJson | undefined = undefined;
  expect(comp).toBeUndefined();
  expect(typeof AepComposition).toBe('object'); // React.memo component
  expect(typeof GsapPixieContextProvider).toBe('function');
  expect(typeof PixiSequenceWrapper).toBe('function');
  expect(typeof parseAepComposition).toBe('function');
  expect(typeof parseAepCompositionSafe).toBe('function');
  expect(typeof aepCompositionSchema).toBe('object');
  expect(typeof GsapPixieContext).toBe('object');
});

it('shares one React copy with the engine', () => {
  let seen: { handlePlay: unknown; handleSeek: unknown } | undefined;
  const Probe = () => {
    seen = React.useContext(GsapPixieContext) as never;
    return null;
  };
  render(
    <GsapPixieContextProvider>
      <Probe />
    </GsapPixieContextProvider>,
  );
  expect(typeof seen?.handlePlay).toBe('function');
  expect(typeof seen?.handleSeek).toBe('function');
});
