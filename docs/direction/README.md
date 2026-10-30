# Direction notes

Film-direction craft for the crew, copied from [video-director](https://github.com/win4r/video-director) (MIT, copyright 2026 win4r).
The upstream licence text is in [LICENSE-video-director](LICENSE-video-director).

| File | From | Use here |
|---|---|---|
| [principles.md](principles.md) | `video-director/SKILL.md` | The stance, the dials and the 13 principles. The showrunner's direction block is distilled from it. |
| [craft.md](craft.md) | `references/craft.md` | Numbers: holds, easing, staggers, type floors, transitions. The builder's direction block is distilled from it. |
| [quality.md](quality.md) | `references/quality.md` | The AI-tells list and the critic rubric. Reference for review rules. |

These files are unchanged copies. They describe a code-rendered video pipeline (HTML, GSAP, MP4, audio), so read workflow, render and sound
steps as background only. What the crew actually uses is in `DIRECTION` in `server/crew/prompts.ts`, written for our tools: four eases
(`linear`, `easeIn`, `easeOut`, `easeInOut`), layers and keyframes, a 5 % safe area, no audio.
