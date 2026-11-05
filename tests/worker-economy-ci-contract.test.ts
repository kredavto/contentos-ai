import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
it('explicitly runs the real queue integration gate with required fixture services',()=>{
  const workflow=readFileSync('.github/workflows/ci.yml','utf8');
  expect(workflow).toContain('name: Verify economy queue locking and graceful drain');
  expect(workflow).toContain('REQUIRE_ECONOMY_INTEGRATION: "1"');
  expect(workflow).toContain('pnpm exec vitest run tests/integration/worker-economy.integration.test.ts');
  expect(workflow).toContain('TEST_DATABASE_URL: postgresql://contentos:ci-test-only@localhost:5432/contentos_test');
  expect(workflow).toContain('TEST_REDIS_URL: redis://localhost:6379/14');
});
