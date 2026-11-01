# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: crew.spec.ts >> crew studio: four builders at once, a mid-build message adds a scene, the film finishes
- Location: e2e/crew.spec.ts:7:1

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.evaluate: Test timeout of 30000ms exceeded.
Call log:
  - waiting for locator('[data-testid="slot-player"] canvas').first()
    - locator resolved to visible <canvas width="1920" height="1080" data-engine="three.js r184"></canvas>

```

# Page snapshot

```yaml
- generic [ref=e3]:
  - banner [ref=e4]:
    - button "PixiTween Director, home" [ref=e5] [cursor=pointer]:
      - strong [ref=e7]: PixiTween Director
    - generic "A morning ritual with a ceramic mug, warm sunrise light" [ref=e8]
    - list "Progress" [ref=e9]:
      - listitem [ref=e10]:
        - button "Brief" [ref=e11] [cursor=pointer]:
          - generic [aria-hidden] [ref=e12]: ✓
      - listitem [ref=e14]:
        - button "Plan" [ref=e15] [cursor=pointer]:
          - generic [aria-hidden] [ref=e16]: ✓
      - listitem [ref=e18]:
        - button "Build" [ref=e19] [cursor=pointer]:
          - generic [aria-hidden] [ref=e20]: ✓
      - listitem [ref=e22]:
        - button "Review" [ref=e23] [cursor=pointer]:
          - generic [aria-hidden] [ref=e24]: ✓
      - listitem [ref=e26]:
        - button "Export" [ref=e27] [cursor=pointer]:
          - generic [aria-hidden] [ref=e28]: "5"
    - button [ref=e30] [cursor=pointer]:
      - group "Budget" [ref=e31]:
        - generic [ref=e32]: Budget starts with the first turn
        - progressbar "Budget used" [ref=e34]
    - generic [ref=e35]: ready
    - button "Keyboard shortcuts" [ref=e36] [cursor=pointer]:
      - generic [aria-hidden] [ref=e37]: "?"
    - button "Switch to dark theme" [ref=e38] [cursor=pointer]
    - button "Hide Talk to the showrunner" [pressed] [ref=e41] [cursor=pointer]
  - generic [ref=e44]:
    - navigation "Studio panels" [ref=e45]:
      - tablist [ref=e46]:
        - tab "Plan" [ref=e47] [cursor=pointer]:
          - generic [ref=e51]: "5"
        - tab "Crew" [selected] [ref=e52] [cursor=pointer]
        - tab "Export" [ref=e56] [cursor=pointer]
        - tab "Gallery" [ref=e60] [cursor=pointer]
    - generic [ref=e64]:
      - generic [ref=e65]:
        - generic [ref=e66]: Crew
        - region "Crew" [ref=e69]:
          - generic [ref=e70]:
            - heading "Standing by" [level=2] [ref=e72]
            - tablist "Crew view" [ref=e73]:
              - tab "Lanes" [selected] [ref=e74] [cursor=pointer]
              - tab "Map" [ref=e75] [cursor=pointer]
          - tabpanel "Lanes" [ref=e76]:
            - list [ref=e77]:
              - listitem [ref=e78]:
                - generic [ref=e79]:
                  - generic [ref=e81]: Showrunner
                  - generic [ref=e82]: Muse Wonder
                  - generic [ref=e83]: idle
                  - generic [ref=e84]: 25¢
              - listitem [ref=e85]:
                - generic [ref=e86]:
                  - generic [ref=e88]: Builder 1
                  - generic [ref=e89]: Muse Spark
                  - generic [ref=e90]: idle
                  - generic [ref=e91]: 5¢
                - generic [ref=e92]:
                  - generic "the critic saw the headline over the can" [ref=e93]:
                    - generic [aria-hidden] [ref=e94]: 🔧
                    - generic [ref=e95]: fix
                    - generic [ref=e96]: s2
                    - generic [ref=e97]: done
                    - generic [ref=e98]: 2.4 s
                  - generic "first build" [ref=e99]:
                    - generic [aria-hidden] [ref=e100]: 🏗
                    - generic [ref=e101]: build
                    - generic [ref=e102]: s1
                    - generic [ref=e103]: done
                    - generic [ref=e104]: 3.1 s
              - listitem [ref=e105]:
                - generic [ref=e106]:
                  - generic [ref=e108]: Builder 2
                  - generic [ref=e109]: Muse Spark
                  - generic [ref=e110]: idle
                  - generic [ref=e111]: 6¢
                - generic [ref=e112]:
                  - generic "you asked for a sunset scene" [ref=e113]:
                    - generic [aria-hidden] [ref=e114]: 🏗
                    - generic [ref=e115]: build
                    - generic [ref=e116]: s5
                    - generic [ref=e117]: done
                    - generic [ref=e118]: 2.4 s
                  - generic "first build" [ref=e119]:
                    - generic [aria-hidden] [ref=e120]: 🏗
                    - generic [ref=e121]: build
                    - generic [ref=e122]: s2
                    - generic [ref=e123]: done
                    - generic [ref=e124]: 2.4 s
              - listitem [ref=e125]:
                - generic [ref=e126]:
                  - generic [ref=e128]: Builder 3
                  - generic [ref=e129]: Muse Spark
                  - generic [ref=e130]: idle
                  - generic [ref=e131]: 3¢
                - generic "first build" [ref=e133]:
                  - generic [aria-hidden] [ref=e134]: 🏗
                  - generic [ref=e135]: build
                  - generic [ref=e136]: s3
                  - generic [ref=e137]: done
                  - generic [ref=e138]: 2.4 s
              - listitem [ref=e139]:
                - generic [ref=e140]:
                  - generic [ref=e142]: Builder 4
                  - generic [ref=e143]: Muse Spark
                  - generic [ref=e144]: idle
                  - generic [ref=e145]: 3¢
                - generic "first build" [ref=e147]:
                  - generic [aria-hidden] [ref=e148]: 🏗
                  - generic [ref=e149]: build
                  - generic [ref=e150]: s4
                  - generic [ref=e151]: done
                  - generic [ref=e152]: 3.1 s
              - listitem [ref=e153]:
                - generic [ref=e154]:
                  - generic [ref=e156]: Critic
                  - generic [ref=e157]: Muse Spark
                  - generic [ref=e158]: idle
                  - generic [ref=e159]: 6¢
                - generic [ref=e160]:
                  - generic "after fix on s2" [ref=e161]:
                    - generic [aria-hidden] [ref=e162]: 👁
                    - generic [ref=e163]: critique
                    - generic [ref=e164]: s2
                    - generic [ref=e165]: done
                    - generic [ref=e166]: 1.2 s
                  - generic "after build-scene on s5" [ref=e167]:
                    - generic [aria-hidden] [ref=e168]: 👁
                    - generic [ref=e169]: critique
                    - generic [ref=e170]: s5
                    - generic [ref=e171]: done
                    - generic [ref=e172]: 1.2 s
                  - generic "after build-scene on s1" [ref=e173]:
                    - generic [aria-hidden] [ref=e174]: 👁
                    - generic [ref=e175]: critique
                    - generic [ref=e176]: s1
                    - generic [ref=e177]: done
                    - generic [ref=e178]: 1.2 s
                  - generic "after build-scene on s4" [ref=e179]:
                    - generic [aria-hidden] [ref=e180]: 👁
                    - generic [ref=e181]: critique
                    - generic [ref=e182]: s4
                    - generic [ref=e183]: done
                    - generic [ref=e184]: 1.2 s
                  - generic "after build-scene on s3" [ref=e185]:
                    - generic [aria-hidden] [ref=e186]: 👁
                    - generic [ref=e187]: critique
                    - generic [ref=e188]: s3
                    - generic [ref=e189]: done
                    - generic [ref=e190]: 1.2 s
              - listitem [ref=e191]:
                - generic [ref=e192]:
                  - generic [ref=e194]: Continuity
                  - generic [ref=e195]: rules
                  - generic [ref=e196]: idle
                  - generic [ref=e197]: 0¢
                - generic [ref=e198]:
                  - generic "after fix on s2" [ref=e199]:
                    - generic [aria-hidden] [ref=e200]: 🔗
                    - generic [ref=e201]: continuity
                    - generic [ref=e202]: s2
                    - generic [ref=e203]: done
                    - generic [ref=e204]: 12 ms
                  - generic "after build-scene on s5" [ref=e205]:
                    - generic [aria-hidden] [ref=e206]: 🔗
                    - generic [ref=e207]: continuity
                    - generic [ref=e208]: s5
                    - generic [ref=e209]: done
                    - generic [ref=e210]: 11 ms
                  - generic "after build-scene on s1" [ref=e211]:
                    - generic [aria-hidden] [ref=e212]: 🔗
                    - generic [ref=e213]: continuity
                    - generic [ref=e214]: s1
                    - generic [ref=e215]: done
                    - generic [ref=e216]: 11 ms
                  - generic "after build-scene on s4" [ref=e217]:
                    - generic [aria-hidden] [ref=e218]: 🔗
                    - generic [ref=e219]: continuity
                    - generic [ref=e220]: s4
                    - generic [ref=e221]: done
                    - generic [ref=e222]: 11 ms
                  - generic "after build-scene on s3" [ref=e223]:
                    - generic [aria-hidden] [ref=e224]: 🔗
                    - generic [ref=e225]: continuity
                    - generic [ref=e226]: s3
                    - generic [ref=e227]: done
                    - generic [ref=e228]: 11 ms
              - listitem [ref=e229]:
                - generic [ref=e230]:
                  - generic [ref=e232]: Producer
                  - generic [ref=e233]: rules
                  - generic [ref=e234]: idle
                  - generic [ref=e235]: 0¢
              - listitem [ref=e236]:
                - generic [ref=e237]:
                  - generic [ref=e239]: Listener
                  - generic [ref=e240]: rules
                  - generic [ref=e241]: idle
                  - generic [ref=e242]: 0¢
              - listitem [ref=e243]:
                - generic [ref=e244]:
                  - generic [ref=e246]: Local
                  - generic [ref=e247]: Muse Glimmer
                  - generic [ref=e248]: idle
                  - generic [ref=e249]: 0¢
      - separator "Resize tab panel" [ref=e250]
      - generic [ref=e252]:
        - generic [ref=e259]:
          - button "Pause" [active] [ref=e260] [cursor=pointer]
          - slider "Seek" [ref=e261]: "0.66"
          - generic [ref=e262]: 0:00.7
        - group "Scenes" [ref=e263]:
          - list [ref=e264]:
            - listitem [ref=e265]:
              - button "1 3d 4s Reveal the can in low morning light" [ref=e266] [cursor=pointer]:
                - generic [ref=e267]:
                  - generic [ref=e268]: "1"
                  - generic "3d" [ref=e269]
                  - generic [ref=e270]: 4s
                - generic [ref=e271]: Reveal the can in low morning light
            - listitem [ref=e272]:
              - button "2 motion 4s The pour into a glass over ice" [ref=e273] [cursor=pointer]:
                - generic [ref=e274]:
                  - generic [ref=e275]: "2"
                  - generic "motion" [ref=e276]
                  - generic [ref=e277]: 4s
                - generic [ref=e278]: The pour into a glass over ice
            - listitem [ref=e279]:
              - button "3 motion 4s Sunset glow wraps the can" [ref=e280] [cursor=pointer]:
                - generic [ref=e281]:
                  - generic [ref=e282]: "3"
                  - generic "motion" [ref=e283]
                  - generic [ref=e284]: 4s
                - generic [ref=e285]: Sunset glow wraps the can
            - listitem [ref=e286]:
              - button "4 motion 4s A close look at the label" [ref=e287] [cursor=pointer]:
                - generic [ref=e288]:
                  - generic [ref=e289]: "4"
                  - generic "motion" [ref=e290]
                  - generic [ref=e291]: 4s
                - generic [ref=e292]: A close look at the label
            - listitem [ref=e293]:
              - button "5 motion 4s Close on the can with the tagline" [ref=e294] [cursor=pointer]:
                - generic [ref=e295]:
                  - generic [ref=e296]: "5"
                  - generic "motion" [ref=e297]
                  - generic [ref=e298]: 4s
                - generic [ref=e299]: Close on the can with the tagline
          - generic [ref=e300]: 20s
      - separator "Resize Talk to the showrunner" [ref=e301]
      - generic [ref=e302]:
        - generic [ref=e303]: Talk to the showrunner
        - generic [ref=e305]:
          - log "Director's notes" [ref=e306]:
            - paragraph [ref=e308]: "Four scenes: the reveal, the pour, the label and the close."
            - generic [ref=e309]:
              - generic [ref=e310]: heard
              - paragraph [ref=e311]: add a sunset scene after scene 2
            - paragraph [ref=e313]: Adding a sunset scene.
            - paragraph [ref=e315]: 5 scenes built and checked.
            - generic [ref=e316]:
              - paragraph [ref=e317]: Your film is ready
              - generic [ref=e318]:
                - img "First frame of your film" [ref=e319]
                - button "Play" [ref=e320] [cursor=pointer]: ▶ Play
          - generic [ref=e321]:
            - generic [ref=e322]:
              - button "Push to talk" [ref=e324] [cursor=pointer]:
                - generic [ref=e326]: Hold to talk
              - textbox "Message" [ref=e327]:
                - /placeholder: Tell the showrunner…
              - button "Send" [disabled] [ref=e328]:
                - generic [aria-hidden] [ref=e329]: ↑
            - paragraph [ref=e330]: Enter to send · hold Space to talk
```

# Test source

```ts
  1  | import path from 'node:path';
  2  | import { expect, test } from '@playwright/test';
  3  | 
  4  | // Runs with `npm run e2e:crew` (crew mode on, fake workers slowed to 1.2 s so four lanes overlap).
  5  | const PRODUCT = path.resolve('fixtures/seed/mug-product.png');
  6  | 
  7  | test('crew studio: four builders at once, a mid-build message adds a scene, the film finishes', async ({ page }) => {
  8  |   const hosts = new Set<string>();
  9  |   page.on('request', (r) => {
  10 |     const u = new URL(r.url());
  11 |     if (u.protocol.startsWith('http')) hosts.add(u.hostname);
  12 |   });
  13 | 
  14 |   await page.goto('/');
  15 |   // the chat intake replaces the form in crew mode
  16 |   await expect(page.getByRole("log", { name: "Conversation" })).toBeVisible();
  17 |   await page.getByLabel("Product photo").setInputFiles(PRODUCT);
  18 |   await page.getByLabel('Message').fill('A morning ritual with a ceramic mug, warm sunrise light');
  19 |   await page.getByRole('button', { name: 'Send', exact: true }).click();
  20 |   await expect(page).toHaveURL(/[?&]film=film_/);
  21 | 
  22 |   const studio = page.getByTestId('crew-studio');
  23 |   await expect(studio).toBeVisible();
  24 | 
  25 |   // the crew board sits behind the Crew tab of the rail; four builder lanes are working at the same moment
  26 |   await page.getByTestId('rail-crew').click();
  27 |   const working = page.locator('.lane-builder .state-pill.st-working');
  28 |   await expect(working).toHaveCount(4, { timeout: 30_000 });
  29 | 
  30 |   // the map shows the same four builders lit
  31 |   await page.getByRole('tab', { name: 'Map' }).click();
  32 |   await expect(page.locator('[data-node^="builder:"].is-lit')).toHaveCount(4, { timeout: 15_000 });
  33 |   await page.getByRole('tab', { name: 'Lanes' }).click();
  34 | 
  35 |   // the hero scene is a 3D scene: its card says so, and the plan shows the reason on hover
  36 |   await page.getByTestId('rail-plan').click();
  37 |   await expect(page.locator('[data-scene="s1"] .tag.mode-3d')).toHaveText('3D');
  38 |   await expect(page.locator('[data-scene="s2"] .tag.mode-motion')).toHaveText('motion');
  39 |   await page.getByTestId('rail-crew').click();
  40 | 
  41 |   // a message while they work lands in the same thread; the plan grows
  42 |   await page.getByLabel('Message').fill('add a sunset scene after scene 2');
  43 |   await page.getByRole('button', { name: 'Send', exact: true }).click();
  44 |   await expect(page.locator('.bubble.you', { hasText: 'add a sunset scene after scene 2' })).toBeVisible();
  45 |   await expect.poll(async () => page.locator('[data-scene]').evaluateAll((els) => els.map((e) => e.getAttribute('data-scene'))), { timeout: 10_000 }).toHaveLength(5);
  46 |   const order = await page.locator('[data-scene]').evaluateAll((els) => els.map((e) => e.getAttribute('data-scene')));
  47 |   expect(order.indexOf('s5')).toBe(2); // third from the end of five: after s2
  48 | 
  49 |   // the showrunner answers under it, and the film finishes
  50 |   await expect(page.locator('.bubble.crew', { hasText: /sunset/i }).first()).toBeVisible();
  51 |   await expect(page.getByTestId('film-status')).toHaveText('ready', { timeout: 90_000 });
  52 |   await expect(page.locator('[data-scene]')).toHaveCount(5);
  53 |   await expect(page.locator('.bubble.k-ready')).toBeVisible();
  54 | 
  55 |   // the player draws something once it plays (the first frame is the bare background)
  56 |   await page.getByTestId('slot-player').getByRole('button', { name: 'Play' }).click();
  57 |   const painted = () =>
> 58 |     page.locator('[data-testid="slot-player"] canvas').first().evaluate((c: HTMLCanvasElement) => {
     |                                                                ^ Error: locator.evaluate: Test timeout of 30000ms exceeded.
  59 |       const small = document.createElement('canvas');
  60 |       small.width = 16;
  61 |       small.height = 9;
  62 |       const ctx = small.getContext('2d')!;
  63 |       ctx.drawImage(c, 0, 0, 16, 9);
  64 |       const d = ctx.getImageData(0, 0, 16, 9).data;
  65 |       return new Set(Array.from({ length: 144 }, (_, i) => `${d[i * 4]},${d[i * 4 + 1]},${d[i * 4 + 2]}`)).size > 1;
  66 |     });
  67 |   await expect.poll(painted, { timeout: 15_000 }).toBe(true);
  68 | 
  69 |   expect([...hosts].filter((h) => h !== 'localhost' && h !== '127.0.0.1')).toEqual([]);
  70 | 
  71 |   // the film just made can be watched being made: the same log played back, read-only, from the gallery's address
  72 |   const filmId = new URL(page.url()).searchParams.get('film')!;
  73 |   await page.goto(`/?film=${filmId}&replay=1`);
  74 |   await expect(page.getByRole('group', { name: 'Replay' })).toBeVisible();
  75 |   await expect(page.getByRole('button', { name: 'Watch again' })).toBeVisible({ timeout: 60_000 });
  76 |   await expect(page.getByLabel('Message')).toHaveCount(0);
  77 |   await expect(page.getByRole('button', { name: /^Cancel/ })).toHaveCount(0);
  78 |   await page.getByTestId('rail-crew').click();
  79 |   await expect(page.locator('.lane-builder').first()).toBeVisible();
  80 | });
  81 | 
```