// What GitHub's safety checks said: the latest runs on main, the jobs of the
// newest one, and for each job that failed, the step and the notes it left
// (failing tests, mutants not caught, Lighthouse scores: tools/ci-notes.mjs).
// Reads GitHub's public pages for this repo, so no login.
// Use: node tools/ci-status.mjs [how many runs, default 3]
import { execSync } from 'node:child_process';

const repo = execSync('git remote get-url origin', { encoding: 'utf8' }).trim()
  .replace(/^.*github\.com[:/]/, '').replace(/\.git$/, '');
const get = async (path) => {
  const res = await fetch(`https://api.github.com/repos/${repo}/${path}`, { headers: { Accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new Error(`GitHub answered ${res.status} for ${path}`);
  return res.json();
};
const state = (x) => (x.status === 'completed' ? x.conclusion : x.status);

// Only the safety checks (.github/workflows/safety-checks.yml), not the
// GitHub Pages runs. GitHub answers 404 until that file is on main.
const { workflow_runs: runs } = await get(`actions/workflows/safety-checks.yml/runs?branch=main&per_page=${Number(process.argv[2]) || 3}`)
  .catch(() => ({ workflow_runs: [] }));
if (!runs.length) console.log('No safety-check runs on main yet.');
runs.forEach((r) => console.log(`${r.created_at.slice(0, 16).replace('T', ' ')}  ${r.event.padEnd(8)} ${r.head_sha.slice(0, 7)}  ${state(r).padEnd(11)} ${r.html_url}`));

if (runs.length) {
  const { jobs } = await get(`actions/runs/${runs[0].id}/jobs`);
  console.log(`\nNewest run: ${jobs.map((j) => `${j.name}: ${state(j)}`).join(' | ')}`);
  for (const job of jobs.filter((j) => j.conclusion === 'failure')) {
    const steps = job.steps.filter((s) => s.conclusion === 'failure').map((s) => s.name);
    console.log(`\nFAILED ${job.name}, at: ${steps.join(', ') || '(no step named)'}`);
    for (const a of await get(`check-runs/${job.id}/annotations`)) {
      console.log(`  ${a.annotation_level} ${a.path === '.github' ? '' : `${a.path}:${a.start_line} `}${a.message.split('\n').slice(0, 25).join('\n    ')}`);
    }
  }
}
