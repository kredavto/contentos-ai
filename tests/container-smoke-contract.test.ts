import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const runner = 'deploy/smoke-containers.sh';
function simulate(failure = '', exitCode = '0') {
  const directory = mkdtempSync(join(tmpdir(), 'container-contract-'));
  const trace = join(directory, 'trace.jsonl');
  try {
    writeFileSync(join(directory, 'docker'), `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.MOCK_TRACE, JSON.stringify(args)+'\\n');
if (process.env.MOCK_FAILURE && args.join(' ').includes(process.env.MOCK_FAILURE)) process.exit(1);
if (args[0] === 'logs') console.log(process.env.MOCK_WORKER_LOG || '{"event":"worker_started","provider":"disabled"}');
if (args[0] === 'inspect') console.log(process.env.MOCK_EXIT_CODE);
`, { mode: 0o755 });
    writeFileSync(join(directory, 'sleep'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const result = spawnSync('bash', [runner], {
      encoding: 'utf8', timeout: 15000,
      env: { PATH: `${directory}:${process.env.PATH}`, MOCK_TRACE: trace, MOCK_FAILURE: failure, MOCK_EXIT_CODE: exitCode,
        GITHUB_RUN_ID: 'contract', GITHUB_RUN_ATTEMPT: '1' },
    });
    return { ...result, calls: readFileSync(trace, 'utf8').trim().split('\n').map(line => JSON.parse(line) as string[]) };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
describe('container acceptance orchestration contract (mock Docker, not image acceptance)', () => {
  it('has valid bash syntax', () => {
    expect(spawnSync('bash', ['-n', runner]).status).toBe(0);
  });
  it('builds both targets, uses isolation/hardening, migrates twice before startup and cleans owned resources', () => {
    const result = simulate();
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    const calls = result.calls;
    expect(calls.filter(call => call[0] === 'build').map(call => call[2])).toEqual(['worker', 'web']);
    expect(calls.some(call => call[0] === 'network' && call[1] === 'create' && call[2] === '--internal')).toBe(true);
    const migrations = calls.flatMap((call, index) => call.includes('node_modules/@contentos/db/src/migrate.ts') ? [index] : []);
    expect(migrations).toHaveLength(2);
    const workerStart = calls.findIndex(call => call[0] === 'run' && call[1] === '-d' && call.includes('--memory') && call.includes('3g'));
    expect(migrations[1]).toBeLessThan(workerStart);
    const appRuns = calls.filter(call => call[0] === 'run' && call.some(value => /:worker$|:web$/.test(value)));
    for (const call of appRuns) {
      expect(call).toContain('--read-only'); expect(call).toContain('--cap-drop');
      expect(call).toContain('ALL'); expect(call).toContain('no-new-privileges');
      expect(call).toContain('--tmpfs'); expect(call).not.toContain('--env-file');
    }
    for (const call of calls) for (const argument of call) {
      expect(['-p', '--publish', '--privileged', '--build-arg', '--secret']).not.toContain(argument);
    }
    expect(calls.some(call => call.includes('none') && call.includes('smoke-worker.mjs'))).toBe(true);
    expect(calls.some(call => call.includes('/app/smoke-web.mjs'))).toBe(true);
    expect(calls.some(call => call[0] === 'stop' && call[1] === '--time' && call[2] === '30')).toBe(true);
    const cleanup = calls.find(call => call[0] === 'rm');
    expect(cleanup).toBeDefined();
    expect(cleanup!.slice(2).every(name => name.startsWith('contentos-smoke-contract-revision-1-'))).toBe(true);
    expect(calls.at(-1)?.slice(0, 2)).toEqual(['image', 'rm']);
  });
  it.each(['build --target worker', 'node_modules/@contentos/db/src/migrate.ts', '/app/smoke-web.mjs', '3190/health', 'logs --tail', 'stop --time'])('preserves failure and cleans exact owned resources after %s', failure => {
    const result = simulate(failure);
    expect(result.status).not.toBe(0);
    expect(result.calls.some(call => call[0] === 'rm' && call[1] === '-fv')).toBe(true);
    expect(result.calls.some(call => call[0] === 'network' && call[1] === 'rm')).toBe(true);
    expect(result.stdout).not.toContain('container_smoke:passed');
  });
  it('rejects forced kill rather than claiming graceful shutdown', () => {
    const result = simulate('', '137');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('container_smoke_failed:worker_graceful_stop');
  });
  it.each([
    ['{"event":"worker_started"}\n', 0],
    ['{"event":"worker_started"}\n{"event":"dispatch_error","secret":"sentinel-log-secret"}', 1],
    ['sentinel-log-secret', 1],
    ['{"event":"other"}', 1],
    ['x'.repeat(65537), 1],
  ] as const)('validates bounded worker logs without echoing input %#', (input, status) => {
    const result = spawnSync(process.execPath, ['deploy/check-worker-smoke-logs.mjs'], { input, encoding: 'utf8' });
    expect(result.status).toBe(status);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe(status ? 'container_smoke_failed:worker_log_validation\n' : '');
  });
  it('CI uses an independent bounded Ubuntu job with no publication permissions', () => {
    const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
    const job = workflow.slice(workflow.indexOf('\n  container-smoke:'));
    expect(job).toContain('runs-on: ubuntu-24.04');
    expect(job).toContain('timeout-minutes: 30');
    expect(job).toContain('contents: read');
    expect(job).toContain('bash deploy/smoke-containers.sh');
    expect(job).not.toContain('secrets.'); expect(job).not.toContain('packages: write');
  });
});
