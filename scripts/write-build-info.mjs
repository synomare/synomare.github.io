import { promises as fs } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const posts = JSON.parse(await fs.readFile(path.join(root, 'notes', 'posts.json'), 'utf8'));
const works = JSON.parse(await fs.readFile(path.join(root, 'works', 'works.json'), 'utf8'));
const info = {
  sha: process.env.GITHUB_SHA || 'local',
  generatedAt: new Date().toISOString(),
  notes: Array.isArray(posts) ? posts.length : 0,
  works: Array.isArray(works) ? works.length : 0
};
await fs.writeFile(path.join(root, 'build-info.json'), `${JSON.stringify(info, null, 2)}\n`, 'utf8');
console.log(`Build info: ${info.sha} / Notes ${info.notes} / Works ${info.works}`);
