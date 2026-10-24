import {errorReporterFromEnvironment} from '@contentos/providers/error-reporting';
const runtime=globalThis as typeof globalThis & {contentosErrors?:ReturnType<typeof errorReporterFromEnvironment>};
export function errorReporter(){return runtime.contentosErrors??=errorReporterFromEnvironment(process.env,'web');}
