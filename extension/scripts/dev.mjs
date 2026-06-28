import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const extensionDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(extensionDir, "src");
const buildDir = path.join(extensionDir, "build");
const contentMarkets = ["ozon", "wb", "aliexpress", "amazon"];

await mkdir(buildDir, { recursive: true });

const common = {
  bundle: true,
  target: ["chrome114"],
  legalComments: "none",
  sourcemap: true,
};

const contexts = await Promise.all([
  esbuild.context({
    ...common,
    entryPoints: getContentEntryPoints(),
    format: "iife",
    outdir: path.join(buildDir, "content"),
    entryNames: "[name]",
  }),
  esbuild.context({
    ...common,
    entryPoints: [path.join(srcDir, "background/service-worker.js")],
    format: "iife",
    outfile: path.join(buildDir, "background/service-worker.js"),
  }),
  esbuild.context({
    ...common,
    entryPoints: [
      path.join(srcDir, "popup/popup.js"),
      path.join(srcDir, "options/options.js"),
      path.join(srcDir, "history/history.js"),
    ],
    format: "iife",
    outbase: srcDir,
    outdir: buildDir,
    entryNames: "[dir]/[name]",
  }),
]);

await Promise.all(contexts.map((context) => context.watch()));
console.log("Watching extension build artifacts");

function getContentEntryPoints() {
  return Object.fromEntries(
    contentMarkets.map((market) => [market, path.join(srcDir, `content/${market}.js`)]),
  );
}

async function dispose() {
  await Promise.all(contexts.map((context) => context.dispose()));
}

process.on("SIGINT", async () => {
  await dispose();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await dispose();
  process.exit(0);
});
