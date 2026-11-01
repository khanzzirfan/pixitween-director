# engine

The Motion engine: our own GSAP + Three.js player for a single JSON document. It is its own folder with its own
`package.json` and `tsconfig.json`, but it uses the repo's `node_modules` and never imports from `web/`,
`server/` or `shared/`.
See [docs/README.md](./docs/README.md) for the architecture, the decisions and the phase plan.
