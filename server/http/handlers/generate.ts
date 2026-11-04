// Owned by S7a (PRD prd-s07a-clippy-client). Mode and approve routes; routes.ts calls registerGenerateRoutes and is never edited.
import type { Hono } from 'hono';
import { isFilmId } from '@shared/composition';
import { loadEnv } from '../../env';
import { ApprovalError } from '../../generate/approval';
import { buildProposalInfo, countGenerateScenes, MAX_GENERATE_SCENES, setSceneMode } from '../../generate/mode';
import { assertPublicUrl, PublicUrlError } from '../../generate/public-url';
import { getGenerationRunner, getRevertHandler } from '../../generate/runner-registry';
import { getGenerateServices } from '../../generate/services';
import { selectSource } from '../../generate/source-still';
import { modeRequestSchema, type Proposal } from '../../generate/types';
import { CLIPPY_ESTIMATED_CREDITS } from '../../clippy/types';
import { has3D, unplaceProduct3D } from '../../product3d/authoring';
import { getTool } from '../../tools/registry';
import type { AppDeps } from '../deps';

export const STUB_OWNER = 'S7a' as const; // kept so S2's table of owners still resolves; the routes below are real

const APPROVAL_STATUS = { bad_token: 404, token_expired: 410, token_used: 409 } as const;

export function registerGenerateRoutes(app: Hono, deps: AppDeps): void {
  async function loadScene(filmId: string, sceneId: string) {
    if (!isFilmId(filmId)) return undefined;
    try {
      const film = await deps.films.get(filmId);
      const scenes = (film.composition?.meta as { director?: { scenes?: Record<string, unknown> } } | undefined)?.director?.scenes ?? {};
      return film.composition && scenes[sceneId] ? { film, comp: film.composition } : undefined;
    } catch {
      return undefined;
    }
  }

  app.post('/api/films/:id/scenes/:sceneId/mode', async (c) => {
    const { id, sceneId } = c.req.param();
    const body = modeRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'bad_request' }, 400);
    const found = await loadScene(id, sceneId);
    if (!found) return c.json({ error: 'not_found' }, 404);
    const ctx = deps.makeToolCtx(id);
    const current = (found.comp.meta as { director: { scenes: Record<string, { mode: string }> } }).director.scenes[sceneId]!.mode;
    const mode = body.data.mode;

    const setStoryboardMode = async (to: 'motion' | '3d') => {
      const f = await deps.films.get(id);
      if (!f.storyboard?.scenes.some((s) => s.id === sceneId)) return;
      const scenes = f.storyboard.scenes.map((s) => (s.id === sceneId ? { ...s, mode: to, ...(to === '3d' ? { modeReason: 'You chose the real product turning in 3D for this scene.' } : {}) } : s));
      await deps.films.update(id, { storyboard: { ...f.storyboard, scenes } });
    };

    // motion and 3d swap for free: no model call, only the product's layer changes
    if (mode === '3d') {
      if (!loadEnv().PRODUCT_3D) return c.json({ error: '3d_disabled' }, 400);
      if (current === 'generate') {
        const r = await deps.films.mutate(id, (f) => ({ next: setSceneMode(f.composition!, sceneId, 'motion'), data: null }), 'user', `scene ${sceneId} -> motion`);
        if (!r.ok) return c.json({ error: 'invalid_composition' }, 422);
        try {
          await getRevertHandler()?.(ctx, sceneId);
        } catch (e) {
          console.error('revert handler failed', e);
        }
      }
      if (!has3D((await deps.films.get(id)).composition!, sceneId)) {
        const place = getTool('placeProduct3D');
        const done = place ? await place.run({ ...ctx, source: 'user' }, { sceneId }) : { ok: false as const, error: 'the 3D tools are not available' };
        if (!done.ok) return c.json({ error: 'cannot_place', message: done.error }, 422);
      }
      await setStoryboardMode('3d');
      ctx.emit({ type: 'tool.call', name: 'setSceneMode', args: { sceneId, mode: '3d' }, ok: true, version: (await deps.films.get(id)).version });
      return c.json({ mode: '3d' });
    }
    if (has3D(found.comp, sceneId)) {
      const film = await deps.films.get(id);
      const photo = film.assets.find((a) => a.id === film.brief.productAssetId);
      const r = await deps.films.mutate(
        id,
        (f) => ({ next: unplaceProduct3D(f.composition!, sceneId, photo ? { assetId: photo.id, url: photo.url, width: photo.width ?? 1000, height: photo.height ?? 1000 } : undefined), data: null }),
        'user',
        `scene ${sceneId} -> motion`,
      );
      if (!r.ok) return c.json({ error: 'invalid_composition' }, 422);
      await setStoryboardMode('motion');
      ctx.emit({ type: 'tool.call', name: 'setSceneMode', args: { sceneId, mode: 'motion' }, ok: true, version: (await deps.films.get(id)).version });
    }
    if (mode === 'generate' && current !== 'generate' && countGenerateScenes(found.comp) >= MAX_GENERATE_SCENES) return c.json({ error: 'generate_cap' }, 409);
    if (current !== mode) {
      const r = await deps.films.mutate(id, (f) => ({ next: setSceneMode(f.composition!, sceneId, mode), data: null }), 'user', `scene ${sceneId} -> ${mode}`);
      if (!r.ok) return c.json({ error: 'invalid_composition' }, 422);
    }

    if (mode === 'motion') {
      try {
        await getRevertHandler()?.(ctx, sceneId);
      } catch (e) {
        console.error('revert handler failed', e);
      }
      return c.json({ mode: 'motion' });
    }

    const services = getGenerateServices();
    const fresh = await deps.films.get(id);
    const source = selectSource(fresh, fresh.composition!, sceneId);
    const isNew = !services.approvals.hasProposal(id, sceneId);
    const p = services.approvals.propose(id, sceneId, CLIPPY_ESTIMATED_CREDITS);
    const balance = await services.balance.read();
    const info = buildProposalInfo({ film: fresh, comp: fresh.composition!, sceneId, sourceKind: source.kind, balance });
    const proposal: Proposal = { token: p.token, sceneId, attempt: p.attempt, ...info, ...(balance !== undefined ? { balance } : {}), expiresAt: p.expiresAt };
    if (isNew) ctx.emit({ type: 'generate.proposed', sceneId, reason: info.reason, estCredits: CLIPPY_ESTIMATED_CREDITS, token: p.token });
    return c.json({ mode: 'generate', proposal });
  });

  app.post('/api/films/:id/scenes/:sceneId/approve', async (c) => {
    const { id, sceneId } = c.req.param();
    const body = (await c.req.json().catch(() => null)) as { token?: unknown } | null;
    const found = await loadScene(id, sceneId);
    if (!found) return c.json({ error: 'not_found' }, 404);
    const mode = (found.comp.meta as { director: { scenes: Record<string, { mode: string }> } }).director.scenes[sceneId]!.mode;
    if (mode !== 'generate') return c.json({ error: 'not_generate_scene' }, 409);

    const runner = getGenerationRunner();
    if (!runner) return c.json({ error: 'runner_unavailable' }, 501);
    try {
      assertPublicUrl(loadEnv().PUBLIC_BASE_URL);
    } catch (e) {
      if (e instanceof PublicUrlError) return c.json({ error: 'public_url_invalid', message: e.message }, 422);
      throw e;
    }
    const services = getGenerateServices();
    const balance = await services.balance.read();
    if (balance !== undefined && balance < CLIPPY_ESTIMATED_CREDITS) return c.json({ error: 'insufficient_credits' }, 402);

    const ctx = deps.makeToolCtx(id);
    const pre = await runner.preflight(ctx, sceneId);
    if (!pre.ok) return c.json({ error: pre.error, ...(pre.retryAfterSec !== undefined ? { retryAfterSec: pre.retryAfterSec } : {}) }, pre.status as 429);

    // Only now is the token consumed: every failure above leaves it usable.
    let approval;
    try {
      approval = services.approvals.consume(typeof body?.token === 'string' ? body.token : '', id, sceneId);
    } catch (e) {
      if (e instanceof ApprovalError) return c.json({ error: e.code }, APPROVAL_STATUS[e.code]);
      throw e;
    }
    void runner.run(ctx, { sceneId, approval }).catch((e: unknown) => {
      console.error(`generation failed for ${id}/${sceneId}:`, e);
      ctx.emit({ type: 'error', where: 'generate', message: e instanceof Error ? e.message : String(e) });
    });
    return c.json({ accepted: true }, 202);
  });
}
