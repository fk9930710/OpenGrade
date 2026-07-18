import { access, readFile } from "node:fs/promises";

let config;

try {
  config = JSON.parse(
    await readFile("config/storage.local.json", "utf8"),
  );
} catch {
  console.error(
    'Storage is not configured. Run: npm run storage:init -- "/Volumes/DriveName/OpenGrade/data"',
  );
  process.exit(1);
}

const results = await Promise.all(
  Object.entries(config.paths).map(async ([name, directoryPath]) => {
    try {
      await access(directoryPath);
      return { name, path: directoryPath, status: "ready" };
    } catch {
      return { name, path: directoryPath, status: "missing" };
    }
  }),
);

for (const result of results) {
  console.log(
    `${result.status === "ready" ? "✓" : "×"} ${result.name}: ${result.path}`,
  );
}

if (results.some((result) => result.status !== "ready")) {
  process.exit(1);
}

console.log(`Storage Root ready: ${config.root}`);
