// Node resolve hook so the server modules (TypeScript, "@/" imports, extensionless relative imports,
// `import "server-only"`) load in a plain Node script. Used by scripts/advance-flow-check.mjs.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXT = [".ts", ".tsx", "/index.ts", "/index.tsx"];

function withExtension(file) {
  if (fs.existsSync(file) && fs.statSync(file).isFile()) return file;
  for (const e of EXT) if (fs.existsSync(file + e)) return file + e;
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") return { url: "data:text/javascript,export {}", shortCircuit: true };
  if (specifier.startsWith("@/")) {
    const file = withExtension(path.join(ROOT, specifier.slice(2)));
    if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
  }
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
    const file = withExtension(path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier));
    if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
