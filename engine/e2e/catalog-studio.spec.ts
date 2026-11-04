import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

// Studio check: the S19 can film (cb-original) opens in the studio (/?film=<id>), plays and seeks on the motion engine.
// Catalogue films are bare compositions, so GET /api/films/:id is answered here with a FilmState that wraps it.
// Screenshots: debug/app/e2e/studio-*.png; one copy in debug/engine/.

const ID = "cb-original";
const comp = JSON.parse(readFileSync(path.resolve(`web/public/cartoon/catalog/${ID}.json`), "utf8"));
mkdirSync(path.resolve("debug/app/e2e"), { recursive: true });

test("studio plays and seeks the catalogue can film on the motion engine", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));

  const film = {
    id: ID, title: "Coffee Co. Cold Brew", aspect: "9:16", status: "ready",
    brief: { text: "catalogue can", productAssetId: "" }, version: 1, composition: comp,
    assets: [], costUsd: 0.0025, clippyCredits: 0, createdAt: new Date().toISOString(),
  };
  await page.route(`**/api/films/${ID}`, (r) => r.fulfill({ json: film }));
  await page.route(`**/api/films/${ID}/events*`, (r) => r.fulfill({ status: 200, contentType: "text/event-stream", body: ": ok\n\n" }));
  await page.route(`**/api/films/${ID}/versions`, (r) => r.fulfill({ json: { versions: [] } }));
  await page.route("**/api/local-mode", (r) => r.fulfill({ json: { local: false } }));

  await page.goto(`/?film=${ID}`);
  const stage = page.locator('[data-testid="slot-player"]');
  await expect(stage.locator("canvas").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("player-empty")).toHaveCount(0);

  await page.getByRole("button", { name: "Play" }).click();
  await page.waitForTimeout(1500);
  const t = await page.getByTestId("player-time").innerText();
  await page.screenshot({ path: path.resolve("debug/app/e2e/studio-play.png") });
  await page.getByRole("button", { name: "Pause" }).click();

  const seek = page.getByLabel("Seek");
  const max = Number(await seek.getAttribute("max"));
  await seek.evaluate((el: HTMLInputElement, v) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    set.call(el, String(v));
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, max / 2);
  await page.waitForTimeout(600);
  const tMid = await page.getByTestId("player-time").innerText();
  await page.screenshot({ path: path.resolve("debug/app/e2e/studio-seek-mid.png") });
  await page.screenshot({ path: path.resolve("debug/engine/studio-cb-original.png") });

  console.log(JSON.stringify({ filmId: ID, duration: max, timeAfterPlay: t, timeAfterSeek: tMid, consoleErrors: errors }));
  expect(tMid).not.toBe(t);
  expect(errors.filter((e) => !/favicon|404/i.test(e))).toEqual([]);
});
