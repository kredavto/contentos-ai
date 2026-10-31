import { runConfigurationCheck } from './config-check-support.js';

const result = runConfigurationCheck(process.argv.slice(2), process.env);
process.stdout.write(`${result.output}\n`);
process.exitCode = result.exitCode;
