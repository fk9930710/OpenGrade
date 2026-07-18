import { context } from "esbuild";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";

const portFlagIndex = process.argv.indexOf("--port");
const requestedPort =
  portFlagIndex >= 0 ? Number(process.argv[portFlagIndex + 1]) : Number(process.env.PORT);
const listenPort = Number.isInteger(requestedPort) && requestedPort > 0 ? requestedPort : 4173;

await rm("dist", { recursive: true, force: true });
await mkdir("dist/assets", { recursive: true });
const html = await readFile("index.html", "utf8");
await writeFile("dist/index.html", html.replaceAll("./dist/", "./"));

const buildContext = await context({
  entryPoints: ["src/main.tsx"],
  bundle: true,
  outfile: "dist/assets/app.js",
  sourcemap: true,
  target: ["es2022"],
  loader: { ".tsx": "tsx", ".ts": "ts", ".css": "css" },
});

await buildContext.watch();
const { hosts, port: activePort } = await buildContext.serve({
  servedir: "dist",
  host: "127.0.0.1",
  port: listenPort,
});
console.log(`OpenGrade running at http://${hosts?.[0] ?? "127.0.0.1"}:${activePort}`);
