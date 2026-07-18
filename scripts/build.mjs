import { build } from "esbuild";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await mkdir("dist/assets", { recursive: true });
const html = await readFile("index.html", "utf8");
await writeFile("dist/index.html", html.replaceAll("./dist/", "./"));
await build({
  entryPoints: ["src/main.tsx"],
  bundle: true,
  outfile: "dist/assets/app.js",
  minify: true,
  sourcemap: true,
  target: ["es2022"],
  loader: { ".tsx": "tsx", ".ts": "ts", ".css": "css" },
});
