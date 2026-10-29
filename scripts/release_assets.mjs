import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

// Public releases contain reference annotations only. Lab cohorts and imported
// project history remain local until their owner explicitly approves publication.
export function releaseAssets() {
  let root, outDir;
  return {
    name: 'assured-release-assets',
    apply: 'build',
    enforce: 'pre',
    config: () => ({ build: { copyPublicDir: false } }),
    configResolved(config) { root = config.root; outDir = resolve(root, config.build.outDir); },
    load(id) {
      if (id.split('?')[0] === resolve(root, 'src/engine/design/data/historicalProjects.js')) {
        return 'export const HISTORICAL_PROJECTS = []; export const HISTORICAL_PROJECTS_SUMMARY = {recordCount:0};';
      }
    },
    closeBundle() {
      const references = resolve(root, 'public/references');
      if (existsSync(references)) {
        mkdirSync(outDir, { recursive: true });
        cpSync(references, resolve(outDir, 'references'), { recursive: true });
      }
    },
  };
}
