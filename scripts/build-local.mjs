import path from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionDir = path.join(rootDir, "extension");
const contentMarkets = ["ozon", "wb", "aliexpress"];

await esbuild.build({
  entryPoints: Object.fromEntries(
    contentMarkets.map((market) => [market, path.join(extensionDir, `src/content/${market}.js`)]),
  ),
  bundle: true,
  format: "iife",
  target: ["chrome114"],
  legalComments: "none",
  outdir: path.join(extensionDir, "content"),
  entryNames: "[name]",
});

console.log("Built local extension content bundles");
