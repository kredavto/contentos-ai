import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { checkConfiguration, runConfigurationCheck } from '../scripts/config-check-support.js';

vi.mock('node:crypto', async importOriginal => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return { ...actual, randomBytes: vi.fn(() => { throw new Error('Random generation forbidden'); }) };
});

// Deliberately fixed test bytes, not generated encryption material.
const fixture = (): Record<string, string | undefined> => ({
  NODE_ENV: 'production', APP_URL: 'https://example.invalid',
  DATABASE_URL: 'postgresql://fixture:sentinel-db-secret@db.invalid/contentos',
  REDIS_URL: 'rediss://:sentinel-redis-secret@redis.invalid:6379',
  SMTP_URL: 'smtps://fixture:sentinel-smtp-secret@smtp.invalid:465', EMAIL_FROM: 'fixture@example.invalid',
  CREDENTIAL_ENCRYPTION_KEYS: JSON.stringify({ fixture: Buffer.alloc(32, 7).toString('base64') }),
  CREDENTIAL_ACTIVE_KEY_ID: 'fixture', STORAGE_PROVIDER: 's3', S3_REGION: 'fixture-region',
  S3_BUCKET: 'fixture-bucket', S3_ACCESS_KEY_ID: 'sentinel-access-id', S3_SECRET_ACCESS_KEY: 'sentinel-storage-secret',
  FFMPEG_PATH: '/usr/bin/ffmpeg', FFPROBE_PATH: '/usr/bin/ffprobe',
});
const invalid = (changes: Record<string, string | undefined>, role = 'web') => runConfigurationCheck(['--role', role], { ...fixture(), ...changes });

describe('offline production configuration preflight', () => {
  it.each(['web', 'worker'] as const)('accepts locally consistent %s shape without claiming live readiness', role => {
    const result = runConfigurationCheck(['--role', role], fixture());
    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.output);
    expect(report.operationalReadiness).toBe('not_checked');
    expect(report.notChecked).toContain('migrations');
    expect(report.notChecked).toContain('credentials');
    expect(report.profile).toBe('production_core_auth_storage');
  });
  it.each(['NODE_ENV', 'APP_URL', 'DATABASE_URL', 'REDIS_URL', 'SMTP_URL', 'EMAIL_FROM', 'CREDENTIAL_ENCRYPTION_KEYS', 'CREDENTIAL_ACTIVE_KEY_ID', 'STORAGE_PROVIDER', 'S3_REGION', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'])('rejects missing %s', key => {
    expect(invalid({ [key]: undefined }).exitCode).toBe(1);
    expect(invalid({ [key]: '' }).exitCode).toBe(1);
  });
  it.each([
    { NODE_ENV: 'development' }, { APP_URL: 'http://example.invalid' },
    { APP_URL: 'https://user:secret@example.invalid' }, { APP_URL: 'https://example.invalid/path' },
    { APP_URL: 'https://example.invalid?secret=value' }, { APP_URL: 'https://example.invalid#secret' },
    { DATABASE_URL: 'https://db.invalid' }, { DATABASE_URL: 'postgresql://db.invalid/db#fragment' },
    { REDIS_URL: 'redis://redis.invalid#fragment' }, { S3_ENDPOINT: 'https://user:secret@storage.invalid' },
    { S3_ENDPOINT: 'https://storage.invalid/path' }, { S3_ENDPOINT: 'https://storage.invalid?query=value' }, { REDIS_URL: 'https://redis.invalid' },
    { SMTP_URL: 'https://smtp.invalid' }, { SMTP_URL: 'smtps://smtp.invalid/unsupported' },
    { SMTP_URL: 'smtps://smtp.invalid?pool=true' },
    { SMTP_URL: 'smtp://smtp.invalid?ignoreTLS=true' }, { SMTP_URL: 'smtps://smtp.invalid?tls.rejectUnauthorized=false' }, { SMTP_URL: 'smtps://smtp.invalid?name=one&name=two' },
    { SMTP_URL: 'smtps://%ZZ:password@smtp.invalid' }, { S3_BUCKET: 'INVALID_BUCKET' }, { EMAIL_FROM: 'Display Name <fixture@example.invalid>' },
    { STORAGE_PROVIDER: 'disabled' }, { S3_ENDPOINT: 'http://storage.invalid' },
    { S3_FORCE_PATH_STYLE: 'yes' }, { S3_ENCRYPTION: 'unknown' },
    { S3_ENCRYPTION: 'aws:kms' }, { S3_KMS_KEY_ID: 'fixture' },
    { AI_PROVIDER: 'mock' }, { VIDEO_PROVIDER: 'mock' },
    { CREDENTIAL_ENCRYPTION_KEYS: '{}' }, { CREDENTIAL_ENCRYPTION_KEYS: '{invalid' },
    { CREDENTIAL_ENCRYPTION_KEYS: JSON.stringify({ fixture: 'invalid' }) },
    { CREDENTIAL_ENCRYPTION_KEYS: JSON.stringify({ fixture: Buffer.alloc(31).toString('base64') }) },
    { CREDENTIAL_ACTIVE_KEY_ID: 'absent' },
  ])('rejects malformed or inconsistent configuration %#', changes => {
    expect(invalid(changes).exitCode).toBe(1);
  });
  it('accepts explicit safe SMTP options', () => {
    expect(invalid({ SMTP_URL: 'smtp://smtp.invalid?requireTLS=true&tls.rejectUnauthorized=true&tls.minVersion=TLSv1.2&name=fixture' }).exitCode).toBe(0);
  });
  it('supports conservative S3 custom endpoint and KMS shape without constructing a provider', () => {
    expect(invalid({ S3_ENDPOINT: 'https://storage.invalid', S3_FORCE_PATH_STYLE: 'true', S3_ENCRYPTION: 'aws:kms', S3_KMS_KEY_ID: 'fixture-kms' }).exitCode).toBe(0);
  });
  it('checks worker binary paths, not filesystem existence or execution', () => {
    expect(invalid({ FFMPEG_PATH: '/does/not/exist', FFPROBE_PATH: '/does/not/exist' }, 'worker').exitCode).toBe(0);
    expect(invalid({ FFMPEG_PATH: undefined }, 'worker').exitCode).toBe(1);
    expect(invalid({ FFPROBE_PATH: 'ffprobe' }, 'worker').exitCode).toBe(1);
    expect(invalid({ FFMPEG_PATH: undefined, FFPROBE_PATH: undefined }).exitCode).toBe(0);
  });
  it.each([[], ['--role'], ['--role', 'other'], ['--role', 'web', 'extra'], ['--help'], ['--role=web']].map(args => ({ args })))('returns usage code 2 without echoing arguments %#', ({ args }) => {
    const result = runConfigurationCheck(args, {});
    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.output).code).toBe('invalid_arguments');
  });
  it('never includes input values, URLs, key IDs or raw parser errors in output', () => {
    const sentinel = 'sentinel-sensitive-INPUT';
    const source = Object.fromEntries(Object.keys(fixture()).map(key => [key, sentinel]));
    source.CREDENTIAL_ACTIVE_KEY_ID = sentinel;
    for (const result of [runConfigurationCheck(['--role', 'web'], source), runConfigurationCheck([sentinel], source)]) {
      expect(result.output).not.toContain(sentinel);
      expect(result.output).not.toContain('ZodError');
      expect(result.output).not.toContain('stack');
    }
    const valid = runConfigurationCheck(['--role', 'worker'], fixture()).output;
    for (const value of Object.values(fixture())) if (value && value.length > 10) expect(valid).not.toContain(value);
  });
  it('executes the exact CLI entrypoint with safe stdout/stderr and exit codes', () => {
    for (const [args, env, expected] of [
      [['--role', 'web'], fixture(), 0],
      [['--role', 'worker'], { ...fixture(), CREDENTIAL_ENCRYPTION_KEYS: 'sentinel-malformed-secret' }, 1],
      [['sentinel-secret-argument'], fixture(), 2],
    ] as const) {
      const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/config-check.ts', ...args], { cwd: process.cwd(), env, encoding: 'utf8' });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(expected);
      expect(result.stderr).toBe('');
      expect(result.stdout).not.toContain('sentinel');
      expect(() => JSON.parse(result.stdout)).not.toThrow();
    }
  });
  it('the CLI writes only the safe report and sets the documented exit code', async () => {
    const originalArgv = process.argv;
    const originalEnv = process.env;
    const originalExitCode = process.exitCode;
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    try {
      process.argv = ['node', 'config-check.ts', '--role', 'web'];
      process.env = fixture();
      await import('../scripts/config-check.js');
      expect(process.exitCode).toBe(0);
      expect(stdout).toHaveBeenCalledTimes(1);
      expect(String(stdout.mock.calls[0]?.[0])).not.toContain('sentinel');
      expect(stderr).not.toHaveBeenCalled();
    } finally {
      process.argv = originalArgv; process.env = originalEnv; process.exitCode = originalExitCode;
      stdout.mockRestore(); stderr.mockRestore();
    }
  });
  it('does not mutate input, call fetch, log or require any environment defaults', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('Network forbidden'); });
    const logSpy = vi.spyOn(console, 'log');
    try {
      const source = Object.freeze(fixture());
      expect(checkConfiguration(source, 'worker').offlineValid).toBe(true);
      expect(runConfigurationCheck(['--role', 'web'], {}).exitCode).toBe(1);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(randomBytes).not.toHaveBeenCalled();
      expect(logSpy).not.toHaveBeenCalled();
    } finally { fetchSpy.mockRestore(); logSpy.mockRestore(); }
  });
});
