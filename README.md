# Is this AI-built tool safe to install?

Paste a GitHub repo URL and get a red / amber / green card: is it maintained, and does it pass basic security checks? One static page, **no backend, no keys**. It runs in the visitor's browser against the public GitHub REST API and the OpenSSF Scorecard API (both CORS-open). Free, by Pearlcity LLC.

- `docs/index.html` + `docs/check.js`: the whole site (GitHub Pages from `/docs`).
- `test/run.mjs`: run the same logic in Node: `node test/run.mjs owner/repo ...`. Real output is in `test/sample-output.txt`, and a browser render is in `test/preview.png`.

## Scoring (100 points)
- **Maintained (45):** last push, weeks with commits in 90 days (`stats/participation`), contributors, closed issues/PRs in 90 days, releases.
- **Trust (25):** license, stars/forks (weak), repo age, archived/fork.
- **Security (30):** Scorecard overall + Dangerous-Workflow, Vulnerabilities, Binary-Artifacts. If there's no Scorecard scan, security shows as "unknown" and the card can't be green.
- **Red overrides:** archived, no push in more than 365 days, Dangerous-Workflow = 0. Green needs ≥70 with at most one amber flag.

About 6 GitHub requests per check, so roughly 10 checks/hour per visitor IP (GitHub's unauthenticated limit). Results are cached in localStorage for 1 hour.
Not affiliated with GitHub or OpenSSF. A green card isn't a guarantee.
