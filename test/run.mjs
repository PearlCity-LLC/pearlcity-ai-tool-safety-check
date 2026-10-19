// node test/run.mjs owner/repo ...   -> prints a compact card per repo
import { checkRepo } from "../docs/check.js";
for (const r of process.argv.slice(2)) {
  try {
    const x = await checkRepo(r);
    console.log(`\n${x.light.toUpperCase()} ${x.score}/100  ${x.repo}  (scorecard: ${x.scorecard ? "yes" : "no"})`);
    console.log("  " + x.verdict);
    for (const s of x.signals) console.log(`  - [${s.group}] ${s.label}: ${s.max ? s.pts + "/" + s.max : "?"}  ${s.detail}`);
  } catch (e) { console.log(`\nERROR ${r}: ${e.message}`); }
}
