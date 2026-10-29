import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const checker = new URL('../scripts/check_release.mjs', import.meta.url);
test('release gate accepts reference-only builds and rejects cohorts, project data and local artifacts', () => {
  const root = mkdtempSync(join(tmpdir(), 'assured-release-'));
  const run = () => spawnSync(process.execPath, [checker.pathname, root], { encoding: 'utf8' });
  try {
    writeFileSync(join(root, 'index.html'), '<html>Research tool</html>');
    mkdirSync(join(root, 'assets'));
    writeFileSync(join(root, 'assets', 'main.js'), 'export const app = true;');
    assert.equal(run().status, 0);
    for (const file of ['drive_data/cohort.json', 'demo_traces/trace.ab1', 'local-reviews/key.local', 'assets/source.js.map']) {
      const path = join(root, file);
      mkdirSync(join(path, '..'), { recursive: true });
      writeFileSync(path, 'private');
      assert.notEqual(run().status, 0, file);
      rmSync(join(root, file.split('/')[0]), { recursive: true });
    }
    mkdirSync(join(root, 'assets'));
    for (const marker of ['sourceWorkbook', 'Proj3.1', 'ALPHAGENOME_API_KEY=secret']) {
      writeFileSync(join(root, 'assets', 'main.js'), marker);
      assert.notEqual(run().status, 0, marker);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
