import path from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionDir = path.join(rootDir, "extension");
const contentMarkets = ["ozon", "wb", "aliexpress"];

const context = await esbuild.context({
  entryPoints: Object.fromEntries(
    contentMarkets.map((market) => [market, path.join(extensionDir, `src/content/${market}.js`)]),
  ),
  bundle: true,
  format: "iife",
  target: ["chrome114"],
  legalComments: "none",
  sourcemap: true,
  outdir: path.join(extensionDir, "content"),
  entryNames: "[name]",
});

await context.watch();
console.log("Watching extension content bundles");

async function dispose() {
  await context.dispose();
}

process.on("SIGINT", async () => {
  await dispose();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await dispose();
  process.exit(0);
});
