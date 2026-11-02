import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

// /motion-text3d-lab.html: default text renders, text edits update the stats live, the determinism button
// matches for every text preset, and the cost readouts are numbers.

const DEBUG_DIR = path.resolve("debug/engine");
mkdirSync(DEBUG_DIR, { recursive: true });

test("text3d lab", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => consoleErrors.push(String(e)));

  await page.goto("/motion-text3d-lab.html");
  await expect(page.getByTestId("glyphCount")).toHaveText("17");
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(DEBUG_DIR, "text3d-lab-default.png") });

  await page.getByLabel("Text").fill("ab");
  await expect(page.getByTestId("glyphCount")).toHaveText("2");
  await expect(page.getByTestId("uniqueGeometries")).toHaveText("2");

  await page.getByLabel("Text").fill("Hello world");
  await page.getByLabel("Enter").selectOption("glyphFlip");
  await page.getByLabel("Lighting").selectOption("golden");
  await page.getByLabel("Bevel").uncheck();
  await page.getByLabel("Shadow").uncheck();
  await page.getByLabel("Font").selectOption("regular");
  await page.getByLabel("Align").selectOption("left");
  await page.getByLabel("Size").fill("0.5");
  await page.getByLabel("Depth").fill("0.4");
  await page.getByLabel("Curve segments").fill("12");
  await page.getByLabel("Stagger each").fill("0.08");
  await page.getByLabel("Loop").selectOption("none");
  await page.getByLabel("Exit").selectOption("glyphFadeOut");
  await expect(page.getByTestId("glyphCount")).toHaveText("10");

  await page.getByRole("button", { name: "Check determinism" }).click();
  for (const name of ["glyphPop", "glyphRise", "glyphFlip", "glyphWave"]) {
    await expect(page.getByTestId(`determinism-${name}`)).toContainText("match (", { timeout: 30_000 });
  }
  await page.screenshot({ path: path.join(DEBUG_DIR, "text3d-lab-determinism.png") });

  await expect(page.getByTestId("buildMs")).toHaveText(/^\d+(\.\d+)?$/);
  await expect(page.getByTestId("frameMs")).toHaveText(/^\d+(\.\d+)?$/, { timeout: 15_000 });
  expect(consoleErrors).toEqual([]);
});
