// Run after pnpm build. No remote calls; print names/counts, never secret values.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";
const names = readFileSync(".env.example", "utf8").split(/\r?\n/).filter(line => line.includes("=")).map(line => line.split("=")[0]);
const environments = [process.env, ...[".env", ".env.local", ".env.production", ".env.production.local"]
  .filter(existsSync).map(path => parseEnv(readFileSync(path, "utf8")))];
const needles = [...names, ...environments.flatMap(env => names.flatMap(name => {
  const value = env[name];
  return value ? [value, value.replace(/\\n/g, "\n"), JSON.stringify(value).slice(1, -1)] : [];
}))];
function files(path) { return readdirSync(path, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(join(path, e.name)) : [join(path, e.name)]); }
const chunks = files(".next/static").filter(path => /\.(js|json|html|map)$/.test(path));
if (!chunks.length) throw new Error("Build client assets missing.");
for (const path of chunks) {
  const content = readFileSync(path, "utf8");
  if (needles.some(needle => content.includes(needle))) throw new Error("Private configuration detected in client assets.");
}
console.log(`PASS: ${chunks.length} browser assets contain no private environment names or configured values.`);
