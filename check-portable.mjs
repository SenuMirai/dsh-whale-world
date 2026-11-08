import { readFileSync } from "node:fs";
for (const f of ["lib/index.js","lib/memoryHub.js","lib/memoryRecall.js"]) {
  const t = readFileSync(`C:/DSHwork/plugins-src/dsh-world-066/${f}`, "utf8");
  const hardcoded = t.match(/[A-Z]:\\\\?Users|C:\\\\DSHwork/g);
  console.log(`  ${f.padEnd(24)} 写死路径: ${hardcoded ? "❌ " + hardcoded.length + " 处" : "✓ 无"}`);
}
