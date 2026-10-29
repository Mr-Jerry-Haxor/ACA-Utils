import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const source = path.join(root, 'src');
const dist = path.join(root, 'dist');
const base = JSON.parse(await fs.readFile(path.join(source, 'manifest.base.json'), 'utf8'));

const variants = {
  chromium: {
    ...base,
    minimum_chrome_version: '116',
  },
  firefox: {
    ...base,
    browser_specific_settings: {
      gecko: {
        id: 'aca-compliance-dashboard@boeing.local',
        strict_min_version: '142.0',
        data_collection_permissions: {
          required: ['none'],
        },
      },
    },
  },
};

await fs.mkdir(dist, { recursive: true });
for (const [name, manifest] of Object.entries(variants)) {
  const target = path.join(dist, name);
  await fs.rm(target, { recursive: true, force: true });
  await fs.mkdir(target, { recursive: true });
  for (const entry of await fs.readdir(source, { withFileTypes: true })) {
    if (entry.name === 'manifest.base.json') continue;
    await fs.cp(path.join(source, entry.name), path.join(target, entry.name), { recursive: true });
  }
  await fs.writeFile(path.join(target, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

console.log(`Built ${Object.keys(variants).join(' and ')} extensions in ${dist}`);
