import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const extensionDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(extensionDir, "src");
const buildDir = path.join(extensionDir, "build");
const contentMarkets = ["ozon", "wb", "aliexpress", "amazon"];

await mkdir(buildDir, { recursive: true });
await cleanGeneratedArtifacts(buildDir);

await buildScripts(buildDir, { minify: false });

console.log("Built local extension artifacts");

async function cleanGeneratedArtifacts(outDir) {
  await Promise.all([
    rm(path.join(outDir, "background"), { recursive: true, force: true }),
    rm(path.join(outDir, "content"), { recursive: true, force: true }),
    rm(path.join(outDir, "docs"), { recursive: true, force: true }),
    rm(path.join(outDir, "history", "history.js"), { force: true }),
    rm(path.join(outDir, "history", "history.js.map"), { force: true }),
    rm(path.join(outDir, "options", "options.js"), { force: true }),
    rm(path.join(outDir, "options", "options.js.map"), { force: true }),
    rm(path.join(outDir, "popup", "popup.js"), { force: true }),
    rm(path.join(outDir, "popup", "popup.js.map"), { force: true }),
  ]);
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
