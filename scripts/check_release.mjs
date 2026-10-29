import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, relative } from 'node:path';

const root = resolve(process.argv[2] || 'dist');
if (!existsSync(resolve(root, 'index.html'))) throw new Error('Build the production app before checking release artifacts.');
const forbidden = /(?:^|\/)(?:drive_data|demo_traces|local-reviews|output|\.git|\.vercel)(?:\/|$)|\.(?:ab1|abi|xlsx|assured|local|map)$/i;
const contentMarkers = ['S1 Anlage', 'S1 aufzeichnung', 'sourceWorkbook', 'Proj3.1', 'ASSURED_REVIEW_SECRET=', 'ALPHAGENOME_API_KEY='];
function inspect(dir) {
  for (const name of readdirSync(dir)) {
    const path = resolve(dir, name), rel = relative(root, path).replaceAll('\\', '/');
    if (forbidden.test(rel)) throw new Error(`Non-release artifact found: ${rel}`);
    if (statSync(path).isDirectory()) inspect(path);
    else if (/\.(?:html|js|json|css|txt)$/i.test(name)) {
      const text = readFileSync(path, 'utf8');
      if (contentMarkers.some(marker => text.includes(marker))) throw new Error(`Restricted content found in ${rel}`);
    }
  }
}
inspect(root);
console.log('Release artifacts: no laboratory cohorts, imported project history, local keys or source maps.');
