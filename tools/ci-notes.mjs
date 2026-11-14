// Runs on GitHub, after the safety checks: turns what the mutation tests and
// Lighthouse found into notes on the run (annotations). Anyone can read those
// without logging in, unlike the run's log, so `node tools/ci-status.mjs`
// can show them here.
// Use: node tools/ci-notes.mjs mutation | lighthouse
import fs from 'node:fs';

const read = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
// GitHub's note format: %, CR and LF are written as codes.
const code = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const note = (level, text, file) => console.log(`::${level}${file ? ` file=${file}` : ''}::${code(text)}`);

if (process.argv[2] === 'mutation') {
  const report = read('reports/mutation/mutation.json');
  if (!report) {
    // Stopped before writing one: the end of what it said (the workflow saves it).
    let said = '';
    try { said = fs.readFileSync('reports/mutation-run.log', 'utf8'); } catch { /* no log either */ }
    const end = said.replace(/\x1b\[[0-9;]*m/g, '').trim().split('\n').slice(-30).join('\n');
    note('error', `The mutation tests wrote no report.${end ? `\nThe end of what they said:\n${end}` : ''}`);
  }
  else {
    // One note per file (GitHub shows up to 10 per step), most first.
    const files = Object.entries(report.files)
      .map(([file, f]) => [file, f.mutants.filter((m) => m.status === 'Survived' || m.status === 'NoCoverage')])
      .filter(([, missed]) => missed.length)
      .sort((a, b) => b[1].length - a[1].length);
    files.slice(0, 10).forEach(([file, missed]) => note('warning', `${missed.length} not caught:\n${missed
      .map((m) => `line ${m.location.start.line}: ${m.mutatorName}${m.replacement ? ` -> ${m.replacement}` : ''} (${m.status})`).join('\n')}`, file));
    if (files.length > 10) note('notice', `More files with mutants not caught: ${files.slice(10).map(([file]) => file).join(', ')}`);
  }
}

if (process.argv[2] === 'lighthouse') {
  (read('.lighthouseci/assertion-results.json') || [])
    .filter((a) => !a.passed)
    .forEach((a) => note(a.level === 'error' ? 'error' : 'warning',
      `Lighthouse ${a.auditProperty || a.auditId}: ${a.url.replace(/^https?:\/\/[^/]+/, '')} scored ${a.actual} (runs ${(a.values || []).join(', ')}), needs ${a.operator} ${a.expected}`));
}
