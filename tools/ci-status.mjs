// What GitHub's safety checks said: the latest runs on main, the jobs of the
// newest one, and for each job that failed, the step and the notes it left
// (failing tests, mutants not caught, Lighthouse scores: tools/ci-notes.mjs).
// It also says plainly when GitHub never started the checks (the month's free
// minutes are used up), so that is never mistaken for a failed test.
// A public repo is read with no login. A private one needs the GitHub command
// line tool (gh) logged in; without it, it says so instead of "no runs".
// Use: node tools/ci-status.mjs [how many runs, default 3]
import { execFileSync, execSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

const repo = execSync('git remote get-url origin', { encoding: 'utf8' }).trim()
  .replace(/^.*github\.com[:/]/, '').replace(/\.git$/, '');

// gh when it is there and logged in (it can read private repos), else GitHub's public pages.
// On this Mac gh may live in ~/.local/bin, outside the PATH some tools run with.
const viaGh = (path) => {
  for (const gh of ['gh', join(homedir(), '.local', 'bin', 'gh')]) {
    try {
      return JSON.parse(execFileSync(gh, ['api', `repos/${repo}/${path}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 26 }));
    } catch {
      // not there, or not signed in: the next one
    }
  }
  return null;
};
const get = async (path) => {
  const got = viaGh(path);
  if (got) return got;
  const res = await fetch(`https://api.github.com/repos/${repo}/${path}`, { headers: { Accept: 'application/vnd.github+json' } });
  if (!res.ok) throw Object.assign(new Error(`GitHub answered ${res.status} for ${path}`), { status: res.status });
  return res.json();
};
const state = (x) => (x.status === 'completed' ? x.conclusion : x.status);
// GitHub's words when it refused to start a job for money reasons (free minutes used up, no card).
const NOT_STARTED = /spending limit|payments have failed|billing/i;

// Only the safety checks (.github/workflows/safety-checks.yml), not the
// GitHub Pages runs. GitHub answers 404 until that file is on main, and also
// for a private repo read without a login.
let runs;
try {
  ({ workflow_runs: runs } = await get(`actions/workflows/safety-checks.yml/runs?branch=main&per_page=${Number(process.argv[2]) || 3}`));
} catch (error) {
  if (error.status === 404) {
    console.log(`GitHub showed no safety-check runs for ${repo}. Either .github/workflows/safety-checks.yml is not on main yet,`);
    console.log('or the repo is private and could not be read without a login: run `gh auth login` once, then try again.');
  } else {
    console.log(`Could not reach GitHub (${error.message}). Try again later.`);
  }
  process.exit(0);
}
if (!runs.length) console.log('No safety-check runs on main yet.');
runs.forEach((r) => console.log(`${r.created_at.slice(0, 16).replace('T', ' ')}  ${r.event.padEnd(8)} ${r.head_sha.slice(0, 7)}  ${state(r).padEnd(11)} ${r.html_url}`));

if (runs.length) {
  const { jobs } = await get(`actions/runs/${runs[0].id}/jobs`);
  console.log(`\nNewest run: ${jobs.map((j) => `${j.name}: ${state(j)}`).join(' | ')}`);
  const failed = jobs.filter((j) => j.conclusion === 'failure');
  const notes = new Map();
  for (const job of failed) notes.set(job.id, await get(`check-runs/${job.id}/annotations`));
  // Every failed job is one GitHub never started for money reasons: say that, once, and stop there.
  const unstarted = failed.length > 0 && failed.every((job) => !job.steps?.length && notes.get(job.id).some((a) => NOT_STARTED.test(a.message)));
  if (unstarted) {
    console.log('\nGitHub did not start these checks: this month\'s free minutes for private repos are used up (or a payment is needed).');
    console.log('Nothing failed. They start again on the 1st of the month; never add a card or a budget for this.');
    console.log('The checks on this Mac are the gate (npm audit and npm run test:all).');
  } else {
    for (const job of failed) {
      const steps = (job.steps ?? []).filter((s) => s.conclusion === 'failure').map((s) => s.name);
      console.log(`\nFAILED ${job.name}, at: ${steps.join(', ') || '(no step named)'}`);
      for (const a of notes.get(job.id)) {
        console.log(`  ${a.annotation_level} ${a.path === '.github' ? '' : `${a.path}:${a.start_line} `}${a.message.split('\n').slice(0, 35).join('\n    ')}`);
      }
    }
  }
}
