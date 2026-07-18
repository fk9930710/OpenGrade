import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const requestedRoot = process.argv[2];

if (!requestedRoot || !path.isAbsolute(requestedRoot)) {
  console.error(
    'Usage: npm run storage:init -- "/Volumes/DriveName/OpenGrade/data"',
  );
  process.exit(1);
}

const root = path.normalize(requestedRoot);
const parts = root.split(path.sep).filter(Boolean);

if (parts[0] !== "Volumes" || parts.length < 3) {
  console.error(
    "Storage Root must be a folder on a mounted external volume under /Volumes.",
  );
  process.exit(1);
}

const mountedVolume = path.join(path.sep, parts[0], parts[1]);

try {
  await access(mountedVolume);
} catch {
  console.error(`External volume is not mounted: ${mountedVolume}`);
  process.exit(1);
}

const directoryNames = [
  "assets",
  "models",
  "cache",
  "proxies",
  "renders",
  "projects",
  "exports",
  "tmp",
];

await mkdir(root, { recursive: true });
await Promise.all(
  directoryNames.map((directoryName) =>
    mkdir(path.join(root, directoryName), { recursive: true }),
  ),
);

const storageConfig = {
  version: 1,
  root,
  paths: Object.fromEntries(
    directoryNames.map((directoryName) => [
      directoryName === "tmp" ? "temp" : directoryName,
      path.join(root, directoryName),
    ]),
  ),
};

await mkdir("config", { recursive: true });
await writeFile(
  "config/storage.local.json",
  `${JSON.stringify(storageConfig, null, 2)}\n`,
);

await writeFile(
  path.join(root, "README.txt"),
  [
    "OpenGrade External Storage Root",
    "",
    "This folder stores large, reproducible, or user-selected data.",
    "The OpenGrade source repository and development environments may remain elsewhere.",
    "",
    ...directoryNames.map((directoryName) => `- ${directoryName}/`),
    "",
  ].join("\n"),
);

console.log(`OpenGrade External Storage Root created at ${root}`);
console.log("Local configuration written to config/storage.local.json");
