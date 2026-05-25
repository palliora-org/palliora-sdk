import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const cjsDir = join(process.cwd(), "dist", "cjs");
mkdirSync(cjsDir, { recursive: true });
writeFileSync(
  join(cjsDir, "package.json"),
  JSON.stringify({ type: "commonjs" }, null, 2) + "\n",
  "utf8"
);

