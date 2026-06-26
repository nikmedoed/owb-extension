import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const extensionDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseDir = path.resolve(extensionDir, process.env.RELEASE_DIR || "../../owb-tools-release");
const contentMarkets = ["ozon", "wb", "aliexpress", "amazon"];

await rm(releaseDir, { recursive: true, force: true });
await mkdir(releaseDir, { recursive: true });

await Promise.all([
  copyStaticAssets(),
  writeReleaseManifest(),
  buildReleaseScripts(),
]);

console.log(`Release folder: ${path.relative(extensionDir, releaseDir)}`);

async function copyStaticAssets() {
  await Promise.all([
    cp(path.join(extensionDir, "icons"), path.join(releaseDir, "icons"), { recursive: true }),
    cp(path.join(extensionDir, "docs"), path.join(releaseDir, "docs"), { recursive: true }),
    cp(path.join(extensionDir, "README.md"), path.join(releaseDir, "README.md")),
    copyUiFolder("popup"),
    copyUiFolder("options"),
    copyUiFolder("history"),
  ]);
}

async function copyUiFolder(name) {
  const src = path.join(extensionDir, name);
  const dest = path.join(releaseDir, name);
  await mkdir(dest, { recursive: true });
  await Promise.all([
    cp(path.join(src, `${name}.html`), path.join(dest, `${name}.html`)),
    cp(path.join(src, `${name}.css`), path.join(dest, `${name}.css`)),
  ]);
}

async function writeReleaseManifest() {
  const manifest = JSON.parse(await readFile(path.join(extensionDir, "manifest.json"), "utf8"));
  await writeFile(path.join(releaseDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

async function buildReleaseScripts() {
  const common = {
    bundle: true,
    target: ["chrome114"],
    minify: true,
    legalComments: "none",
  };

  await Promise.all([
    esbuild.build({
      ...common,
      entryPoints: getContentEntryPoints(),
      format: "iife",
      outdir: path.join(releaseDir, "content"),
      entryNames: "[name]",
    }),
    esbuild.build({
      ...common,
      entryPoints: [path.join(extensionDir, "background/service-worker.js")],
      format: "iife",
      outfile: path.join(releaseDir, "background/service-worker.js"),
    }),
    esbuild.build({
      ...common,
      entryPoints: [
        path.join(extensionDir, "popup/popup.js"),
        path.join(extensionDir, "options/options.js"),
        path.join(extensionDir, "history/history.js"),
      ],
      format: "iife",
      outbase: extensionDir,
      outdir: releaseDir,
      entryNames: "[dir]/[name]",
    }),
  ]);
}

function getContentEntryPoints() {
  return Object.fromEntries(
    contentMarkets.map((market) => [market, path.join(extensionDir, `src/content/${market}.js`)]),
  );
}
