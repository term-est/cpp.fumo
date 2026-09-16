import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import { build } from "esbuild";

const arguments_ = process.argv.slice(2);
const option = (name, fallback) => {
  const prefix = `${name}=`;
  return (
    arguments_
      .find((value) => value.startsWith(prefix))
      ?.slice(prefix.length) ?? fallback
  );
};
const outdir = path.resolve(option("--outdir", "build"));
const mode = option("--mode", "development");
if (!new Set(["development", "production"]).has(mode)) {
  throw new Error(`Unsupported frontend build mode: ${mode}`);
}
const production = mode === "production";
const source = path.resolve("frontend/src");
const require = createRequire(import.meta.url);
const codeblocksSource = path.dirname(
  require.resolve("@cppsocial/codeblocks/loader"),
);
const entryPoints = {
  "service-worker": path.join(source, "workers/service-worker.ts"),
  "assets/search-worker": path.join(source, "workers/search-worker.ts"),
  "assets/blogs": path.join(source, "pages/blogs.ts"),
  "assets/directory": path.join(source, "pages/directory.ts"),
  "assets/documentation": path.join(source, "pages/documentation.ts"),
  "assets/event-calendar": path.join(source, "pages/event-calendar.ts"),
  "assets/home": path.join(source, "pages/home.ts"),
  "assets/packages": path.join(source, "pages/packages.ts"),
  "assets/site": path.join(source, "site.ts"),
};

const result = await build({
  bundle: true,
  entryPoints,
  format: "iife",
  minify: production,
  outdir,
  platform: "browser",
  sourcemap: production ? false : "inline",
  target: ["chrome109", "firefox115", "safari16.4"],
  write: false,
});

const generated = new Set(result.outputFiles.map((output) => output.path));
const assetsDirectory = path.join(outdir, "assets");
try {
  for (const entry of await readdir(assetsDirectory, { withFileTypes: true })) {
    const output = path.join(assetsDirectory, entry.name);
    if (
      entry.isFile() &&
      entry.name.endsWith(".js") &&
      !generated.has(output)
    ) {
      await rm(output);
    }
  }
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

for (const output of result.outputFiles) {
  await mkdir(path.dirname(output.path), { recursive: true });
  let current;
  try {
    current = await readFile(output.path);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (!current?.equals(output.contents))
    await writeFile(output.path, output.contents);
}

// Keep the package's directory layout intact: its loader, modules, workers,
// grammars, and WebAssembly files resolve one another with relative URLs.
const codeblocksOutput = path.join(assetsDirectory, "codeblocks");
await rm(codeblocksOutput, { force: true, recursive: true });
await cp(codeblocksSource, codeblocksOutput, { recursive: true });
