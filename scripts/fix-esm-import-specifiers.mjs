import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const esmRoot = join(process.cwd(), "dist", "esm");

const getJsFiles = (dir) => {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const st = statSync(fullPath);
    if (st.isDirectory()) {
      out.push(...getJsFiles(fullPath));
      continue;
    }
    if (fullPath.endsWith(".js")) {
      out.push(fullPath);
    }
  }
  return out;
};

const resolveSpecifier = (currentFile, specifier) => {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
    return specifier;
  }
  if (/\.(js|json|node)$/i.test(specifier)) {
    return specifier;
  }

  const base = resolve(dirname(currentFile), specifier);
  if (existsSync(`${base}.js`)) {
    return `${specifier}.js`;
  }
  if (existsSync(join(base, "index.js"))) {
    return `${specifier}/index.js`;
  }
  return specifier;
};

const rewriteFile = (filePath) => {
  const original = readFileSync(filePath, "utf8");

  const rewritten = original
    .replace(/(from\s+["'])(\.\.?\/[^"']+)(["'])/g, (m, p1, p2, p3) => {
      return `${p1}${resolveSpecifier(filePath, p2)}${p3}`;
    })
    .replace(/(import\(\s*["'])(\.\.?\/[^"']+)(["']\s*\))/g, (m, p1, p2, p3) => {
      return `${p1}${resolveSpecifier(filePath, p2)}${p3}`;
    });

  if (rewritten !== original) {
    writeFileSync(filePath, rewritten, "utf8");
  }
};

if (existsSync(esmRoot)) {
  for (const filePath of getJsFiles(esmRoot)) {
    rewriteFile(filePath);
  }
}

