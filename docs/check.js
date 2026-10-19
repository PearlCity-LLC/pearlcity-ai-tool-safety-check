// AI-tool safety checker (Pearlcity LLC). Runs in the browser (or Node 20+), no backend, no keys.
// Data: GitHub REST API (unauthenticated, 60 req/h per visitor IP) + OpenSSF Scorecard API.
const GH = "https://api.github.com";
const SC = "https://api.securityscorecards.dev/projects/github.com";
const DAY = 86400000;

export function parseRepo(input) {
  const s = String(input || "").trim().replace(/\.git$/, "").replace(/\/+$/, "");
  let m = s.match(/github\.com[/:]([\w.-]+)\/([\w.-]+)/i) || s.match(/^([\w.-]+)\/([\w.-]+)$/);
  return m ? { owner: m[1], repo: m[2] } : null;
}

async function j(url, { allow404 = false } = {}) {
  // Plain GET for Scorecard (a custom header would trigger a CORS preflight it doesn't answer).
  const r = await fetch(url, url.startsWith(GH) ? { headers: { Accept: "application/vnd.github+json" } } : {});
  if (allow404 && r.status === 404) return { _status: 404 };
  if (r.status === 403 || r.status === 429) {
    const reset = r.headers.get("x-ratelimit-reset");
    const when = reset ? new Date(reset * 1000).toLocaleTimeString() : "later";
    throw new Error(`GitHub's free rate limit (60 checks-worth of requests/hour per network) is used up. Try again after ${when}.`);
  }
  if (!r.ok) throw new Error(`${url.startsWith(SC) ? "Scorecard" : "GitHub"} returned ${r.status}`);
  const body = await r.json();
  return { body, headers: r.headers };
}

function lastPageCount(headers, fallback) {
  const link = headers && headers.get("link");
  const m = link && link.match(/[?&]page=(\d+)>;\s*rel="last"/);
  return m ? Number(m[1]) : fallback;
}

const ago = (iso) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / DAY) : null);

export async function checkRepo(input) {
  const p = parseRepo(input);
  if (!p) throw new Error("Paste a GitHub repo URL like https://github.com/owner/repo");
  const base = `${GH}/repos/${p.owner}/${p.repo}`;
  const repoRes = await j(base, { allow404: true });
  if (repoRes._status === 404) throw new Error("Repo not found (or it's private).");
  const repo = repoRes.body;
  const since = new Date(Date.now() - 90 * DAY).toISOString();
  const [commits, participation, contribs, releases, closedIssues, scorecard] = await Promise.all([
    j(`${base}/commits?since=${since}&per_page=100`).catch(() => null),
    j(`${base}/stats/participation`).catch(() => null),
    j(`${base}/contributors?per_page=1&anon=1`).catch(() => null),
    j(`${base}/releases?per_page=1`).catch(() => null),
    j(`${base}/issues?state=closed&since=${since}&per_page=100`).catch(() => null),
    j(`${SC}/${repo.full_name}`, { allow404: true }).catch(() => null),
  ]);

  const c90 = commits ? commits.body : [];
  // Weekly commit counts for the last 52 weeks (one call). Falls back to the 100 most recent commits.
  const part = participation && Array.isArray(participation.body?.all) ? participation.body.all.slice(-13) : null;
  const weeks = part ? { size: part.filter((n) => n > 0).length }
    : new Set(c90.map((c) => Math.floor(new Date(c.commit.author?.date || c.commit.committer?.date).getTime() / (7 * DAY))));
  const commitCount90 = part ? part.reduce((a, b) => a + b, 0) : (c90.length >= 100 ? "100+" : c90.length);
  const authors90 = new Set(c90.map((c) => c.author?.login || c.commit.author?.email));
  const nContrib = contribs ? lastPageCount(contribs.headers, contribs.body.length) : null;
  const lastRelease = releases && releases.body[0] ? releases.body[0].published_at : null;
  const closed90 = closedIssues ? closedIssues.body.length : null;
  const closedLabel = closed90 === 100 && /rel="next"/.test(closedIssues.headers.get("link") || "") ? "100+" : closed90;
  const sc = scorecard && !scorecard._status ? scorecard.body : null;
  const scCheck = (name) => sc?.checks?.find((c) => c.name === name)?.score;

  const lastPush = ago(repo.pushed_at);
  const ageDays = ago(repo.created_at);
  const signals = [];
  const add = (group, label, pts, max, detail, flag = null) => signals.push({ group, label, pts, max, detail, flag });

  // Maintenance (45)
  add("Maintained", "Last code push", lastPush <= 30 ? 12 : lastPush <= 90 ? 8 : lastPush <= 365 ? 3 : 0, 12,
      `${lastPush} days ago`, lastPush > 365 ? "red" : null);
  add("Maintained", "Steady activity (weeks with commits, last 90 days)", Math.min(12, weeks.size), 12,
      `${weeks.size}/13 weeks, ${commitCount90} commits`,
      weeks.size <= 1 && ageDays > 60 ? "amber" : null);
  add("Maintained", "More than one person", nContrib >= 5 ? 8 : nContrib >= 2 ? 5 : 0, 8,
      `${nContrib ?? "?"} contributors all-time, ${authors90.size} active in 90 days`,
      nContrib === 1 ? "amber" : null);
  add("Maintained", "Issues get closed", closed90 >= 5 ? 7 : closed90 >= 1 ? 4 : repo.open_issues_count === 0 ? 4 : 0, 7,
      `${closedLabel ?? "?"} issues/PRs closed in 90 days, ${repo.open_issues_count} open (incl. PRs)`);
  add("Maintained", "Tagged releases", lastRelease ? (ago(lastRelease) <= 180 ? 6 : 3) : 0, 6,
      lastRelease ? `latest ${ago(lastRelease)} days ago` : "no GitHub releases");

  // Trust (25)
  add("Trust", "Open-source license", repo.license && repo.license.spdx_id !== "NOASSERTION" ? 8 : 0, 8,
      repo.license ? repo.license.spdx_id : "none: you may not legally be allowed to use it", repo.license ? null : "amber");
  add("Trust", "Community (stars / forks)", repo.stargazers_count >= 500 ? 8 : repo.stargazers_count >= 50 ? 5 : repo.stargazers_count >= 10 ? 2 : 0, 8,
      `${repo.stargazers_count.toLocaleString()} stars, ${repo.forks_count.toLocaleString()} forks (stars can be bought; treat as weak)`);
  add("Trust", "Track record (repo age)", ageDays >= 365 ? 6 : ageDays >= 90 ? 4 : ageDays >= 30 ? 2 : 0, 6,
      `${ageDays} days old`, ageDays < 14 ? "amber" : null);
  add("Trust", "Not archived / not a bare fork", repo.archived ? 0 : repo.fork ? 1 : 3, 3,
      repo.archived ? "ARCHIVED: owner says it's no longer maintained" : repo.fork ? `fork of ${repo.parent?.full_name || "another repo"}` : "original, active repo",
      repo.archived ? "red" : null);

  // Security (30) via OpenSSF Scorecard
  if (sc) {
    add("Security", "OpenSSF Scorecard overall", Math.round((sc.score / 10) * 18), 18, `${sc.score}/10 (scanned ${sc.date?.slice(0, 10)})`,
        sc.score < 3 ? "amber" : null);
    const dw = scCheck("Dangerous-Workflow"), vu = scCheck("Vulnerabilities"), ba = scCheck("Binary-Artifacts");
    add("Security", "No dangerous CI workflows", dw === 0 ? 0 : dw === undefined || dw < 0 ? 2 : 4, 4, dw === undefined || dw < 0 ? "not checked" : `${dw}/10`, dw === 0 ? "red" : null);
    add("Security", "No known unfixed vulnerabilities", vu === undefined || vu < 0 ? 2 : vu >= 10 ? 4 : vu >= 7 ? 2 : 0, 4,
        vu === undefined || vu < 0 ? "not checked" : `${vu}/10 (10 = none known)`, vu !== undefined && vu >= 0 && vu < 5 ? "amber" : null);
    add("Security", "No checked-in binaries", ba === undefined || ba < 0 ? 2 : ba >= 10 ? 4 : ba >= 5 ? 2 : 0, 4,
        ba === undefined || ba < 0 ? "not checked" : `${ba}/10`);
  } else {
    add("Security", "OpenSSF Scorecard", 0, 0, "No Scorecard scan exists for this repo yet (common for small/new projects). Security is UNKNOWN, not proven bad.", "unknown");
  }

  const pts = signals.reduce((a, s) => a + s.pts, 0);
  const max = signals.reduce((a, s) => a + s.max, 0);
  const score = Math.round((pts / max) * 100);
  const reds = signals.filter((s) => s.flag === "red");
  const ambers = signals.filter((s) => s.flag === "amber");
  let light = score >= 70 ? "green" : score >= 45 ? "amber" : "red";
  if (reds.length) light = "red";
  else if (light === "green" && (ambers.length >= 2 || !sc)) light = "amber";

  const verdict = {
    green: "Looks maintained and reasonably safe to try. Still read what it asks permission to do.",
    amber: "Proceed with care: try it in a throwaway environment and don't give it secrets or broad permissions.",
    red: "High risk: abandoned, flagged, or too new and unproven to trust. Avoid installing unless you've reviewed the code yourself.",
  }[light];
  return { repo: repo.full_name, url: repo.html_url, description: repo.description, light, score, verdict,
           reasons: [...reds, ...ambers].map((s) => `${s.label}: ${s.detail}`), signals, scorecard: !!sc, checkedAt: new Date().toISOString() };
}
