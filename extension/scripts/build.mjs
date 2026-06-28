import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const extensionDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(extensionDir, "src");
const releaseDir = path.resolve(extensionDir, process.env.RELEASE_DIR || "../../owb-tools-release");
const buildDir = path.join(releaseDir, "build");
const localBuildDir = path.join(extensionDir, "build");
const contentMarkets = ["ozon", "wb", "aliexpress", "amazon"];

await rm(releaseDir, { recursive: true, force: true });
await mkdir(buildDir, { recursive: true });

await Promise.all([
  copyStaticAssets(buildDir),
  writeReleaseManifest(),
  buildScripts(buildDir, { minify: true }),
]);

console.log(`Release folder: ${path.relative(extensionDir, releaseDir)}`);

async function copyStaticAssets(outDir) {
  await Promise.all([
    cp(path.join(localBuildDir, "icons"), path.join(outDir, "icons"), { recursive: true }),
    cp(path.join(extensionDir, "README.md"), path.join(releaseDir, "README.md")),
    copyUiFolder("popup", outDir),
    copyUiFolder("options", outDir),
    copyUiFolder("history", outDir),
  ]);
}

async function copyUiFolder(name, outDir) {
  const src = path.join(localBuildDir, name);
  const dest = path.join(outDir, name);
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

async function buildScripts(outDir, { minify }) {
  const common = {
    bundle: true,
    target: ["chrome114"],
    minify,
    legalComments: "none",
  };

  await Promise.all([
    esbuild.build({
      ...common,
      entryPoints: getContentEntryPoints(),
      format: "iife",
      outdir: path.join(outDir, "content"),
      entryNames: "[name]",
    }),
    esbuild.build({
      ...common,
      entryPoints: [path.join(srcDir, "background/service-worker.js")],
      format: "iife",
      outfile: path.join(outDir, "background/service-worker.js"),
    }),
    esbuild.build({
      ...common,
      entryPoints: [
        path.join(srcDir, "popup/popup.js"),
        path.join(srcDir, "options/options.js"),
        path.join(srcDir, "history/history.js"),
      ],
      format: "iife",
      outbase: srcDir,
      outdir: outDir,
      entryNames: "[dir]/[name]",
    }),
  ]);
}

function getContentEntryPoints() {
  return Object.fromEntries(
    contentMarkets.map((market) => [market, path.join(srcDir, `content/${market}.js`)]),
  );
}
