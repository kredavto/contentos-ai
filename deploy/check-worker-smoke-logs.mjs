// Fixture-only input; emit fixed codes, never raw logs, event values or parser errors.
import process from 'node:process';
import { Buffer } from 'node:buffer';
let input = '';
try {
  for await (const chunk of process.stdin) {
    input += chunk.toString();
    if (Buffer.byteLength(input) > 65536) throw new Error('bounded');
  }
  let started = false;
  for (const line of input.split('\n').filter(line => line.trim())) {
    const record = JSON.parse(line);
    if (!record || typeof record.event !== 'string') throw new Error('format');
    if (record.event === 'worker_started') started = true;
    if (record.event.endsWith('_error')) throw new Error('operational');
  }
  if (!started) throw new Error('startup');
} catch {
  process.stderr.write('container_smoke_failed:worker_log_validation\n');
  process.exitCode = 1;
}
