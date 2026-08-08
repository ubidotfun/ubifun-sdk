// Post-process emitted declarations for node16/nodenext consumers:
// 1. Rewrite relative specifiers in each .d.ts with an explicit .js
//    extension (or /index.js for directories) — ESM resolution forbids
//    extensionless relative imports.
// 2. Mirror every .d.ts as a .d.cts with .cjs specifiers so the "require"
//    export condition resolves typed CJS entry points (avoids TS1479).
import { readdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname, resolve } from "path";

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.name.endsWith(".d.ts") ? [full] : [];
  });

const rewriteSpecifier = (fromFile, spec, ext) => {
  if (!spec.startsWith(".")) return spec;
  if (/\.(js|cjs|mjs)$/.test(spec)) return spec;
  const target = resolve(dirname(fromFile), spec);
  if (existsSync(`${target}.d.ts`)) return `${spec}.${ext}`;
  if (existsSync(join(target, "index.d.ts"))) return `${spec}/index.${ext}`;
  return spec;
};

const rewrite = (file, content, ext) =>
  content.replace(
    /(from\s+|import\()["']([^"']+)["']/g,
    (match, prefix, spec) => `${prefix}"${rewriteSpecifier(file, spec, ext)}"`
  );

let count = 0;
for (const file of walk("dist")) {
  const content = readFileSync(file, "utf8");
  writeFileSync(file, rewrite(file, content, "js"));
  writeFileSync(
    file.replace(/\.d\.ts$/, ".d.cts"),
    rewrite(file, content.replace(/^\/\/# sourceMappingURL=.*$/m, ""), "cjs")
  );
  count++;
}
console.log(`emit-cts: fixed ${count} .d.ts files and mirrored to .d.cts`);
