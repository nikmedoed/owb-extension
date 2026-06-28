# AGENTS.md

## Project Shape

OWB Tools is a Chrome Manifest V3 extension plus an optional local Python sync server.

- `extension/` is the load-unpacked extension folder and must stay runnable from a fresh checkout.
- `extension/src/` contains only build inputs, currently JavaScript source files that esbuild consumes.
- `extension/build/` contains generated/load-unpacked artifacts and committed static extension assets.
- `extension/package.json`, `extension/node_modules/`, and `extension/scripts/` are the Node/esbuild build project for the extension.
- `extension/scripts/build-local.mjs` rebuilds committed local artifacts in `extension/build/`.
- `extension/scripts/build.mjs` creates a minified release folder outside the repo at `../owb-tools-release` unless `RELEASE_DIR` is set.
- `server/` contains the optional local sync API.

## Required Workflow

When changing any content script source or shared marketplace logic:

1. Edit source files under `extension/src/**`.
2. Run `npm --prefix extension run build:local`.
3. Keep the generated artifact changes in `extension/build/**`.
4. Run the extension reference check or at least load `extension/` in Chrome.

Before release packaging:

```powershell
npm --prefix extension run build
```

The release output is external by default:

```text
../owb-tools-release
```

## Git Hook

`npm install` from `extension/` runs `prepare`, which sets:

```text
git config core.hooksPath extension/.githooks
```

The pre-commit hook runs `npm run build:local` and stages generated build artifacts. Do not remove generated artifacts from commits; they are required so users can download the repository and load `extension/` without running Node.js.

## Design Constraints

- Keep `manifest.json` pointed at generated files under `extension/build/`.
- Do not put static load-unpacked assets in `extension/src/`. If a file is not transformed by the build step, keep it under `extension/build/` instead. This includes extension `html`, `css`, `icons`, and stale docs.
- Do not change `manifest.key` unless intentionally migrating extension ID and storage. It pins the unpacked extension ID so IndexedDB history survives path moves.
- Add new marketplaces by adding a content entrypoint under `extension/src/content/`, adding the generated bundle under `extension/build/content/`, and updating manifest host permissions/content scripts.
- Avoid introducing a framework unless there is a concrete need. The intended build layer is lightweight esbuild.
- Do not commit `node_modules/`, `dist/`, sourcemaps, or external release folders.
