import { parseServerEnvironment } from '../packages/config/src/index.js';
import { credentialVaultFromEnvironment } from '../packages/core/src/credential-vault.js';

import { smtpConfiguration } from '../packages/providers/src/smtp-configuration.js';

type Environment = Record<string, string | undefined>;
type Role = 'web' | 'worker';
type Code = 'configured' | 'missing' | 'invalid' | 'disabled';
export interface ConfigCheck { target: string; code: Code }
const notChecked = ['connectivity', 'credentials', 'migrations', 'smtp_delivery', 'storage_permissions', 'storage_writes', 'binary_execution', 'worker_health', 'live_providers', 'backups'] as const;

/** Pure, offline production-profile checks. Never return supplied values or parser errors. */
export function checkConfiguration(source: Environment, role: Role) {
  const checks: ConfigCheck[] = [];
  const add = (target: string, code: Code) => {
    const existing = checks.find(check => check.target === target);
    if (existing) existing.code = code;
    else checks.push({ target, code });
  };
  const required = (key: string) => {
    const value = source[key];
    const present = typeof value === 'string' && value.trim().length > 0;
    add(key, present ? 'configured' : 'missing');
    return present;
  };
  const url = (key: string, protocols: string[], originOnly = false) => {
    if (!required(key)) return;
    try {
      const parsed = new URL(source[key]!);
      if (!protocols.includes(parsed.protocol) || !parsed.hostname || parsed.hash ||
        (originOnly && (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/'))) {
        add(key, 'invalid');
      }
    } catch { add(key, 'invalid'); }
  };
  add('NODE_ENV', source.NODE_ENV === undefined ? 'missing' : source.NODE_ENV === 'production' ? 'configured' : 'invalid');
  try { parseServerEnvironment(source); add('runtime_schema', 'configured'); }
  catch { add('runtime_schema', 'invalid'); }
  url('APP_URL', ['https:'], true);
  url('DATABASE_URL', ['postgres:', 'postgresql:']);
  url('REDIS_URL', ['redis:', 'rediss:']);
  url('SMTP_URL', ['smtp:', 'smtps:']);
  if (source.SMTP_URL) {
    try {
      const smtp = smtpConfiguration(source.SMTP_URL, true);
      if (smtp.ignoreTLS === true || smtp.tls?.rejectUnauthorized === false) add('SMTP_URL', 'invalid');
    }
    catch { add('SMTP_URL', 'invalid'); }
  }
  required('EMAIL_FROM'); // Bare email syntax is enforced by the shared runtime schema.
  const keys = required('CREDENTIAL_ENCRYPTION_KEYS');
  const active = required('CREDENTIAL_ACTIVE_KEY_ID');
  if (keys && active) add('credential_vault', credentialVaultFromEnvironment(source) ? 'configured' : 'invalid');
  add('STORAGE_PROVIDER', source.STORAGE_PROVIDER === undefined ? 'missing' : source.STORAGE_PROVIDER === 's3' ? 'configured' : 'invalid');
  for (const key of ['S3_REGION', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']) required(key);
  if (source.S3_BUCKET && !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(source.S3_BUCKET)) add('S3_BUCKET', 'invalid');
  if (source.S3_ENDPOINT !== undefined) url('S3_ENDPOINT', ['https:'], true);
  if (source.S3_ENCRYPTION === 'aws:kms') required('S3_KMS_KEY_ID');
  if (source.S3_KMS_KEY_ID !== undefined && source.S3_ENCRYPTION !== 'aws:kms') add('S3_KMS_KEY_ID', 'invalid');
  // Covers library video processing, generated video and cover processing. Paths only; never execute.
  if (role === 'worker') {
    for (const key of ['FFMPEG_PATH', 'FFPROBE_PATH']) {
      if (required(key) && !source[key]!.startsWith('/')) add(key, 'invalid');
    }
  } else add('worker_binaries', 'disabled');
  return { profile: 'production_core_auth_storage' as const, role, offlineValid: !checks.some(check => check.code === 'missing' || check.code === 'invalid'), operationalReadiness: 'not_checked' as const, checks, notChecked };
}

/** All output is constructed from fixed identifiers; arguments and errors are never echoed. */
export function runConfigurationCheck(args: readonly string[], source: Environment): { exitCode: 0 | 1 | 2; output: string } {
  if (args.length !== 2 || args[0] !== '--role' || (args[1] !== 'web' && args[1] !== 'worker')) {
    return { exitCode: 2, output: JSON.stringify({ code: 'invalid_arguments', usage: 'config:check --role web|worker' }) };
  }
  try {
    const report = checkConfiguration(source, args[1]);
    return { exitCode: report.offlineValid ? 0 : 1, output: JSON.stringify(report) };
  } catch {
    return { exitCode: 1, output: JSON.stringify({ code: 'configuration_check_failed', operationalReadiness: 'not_checked' }) };
  }
}
