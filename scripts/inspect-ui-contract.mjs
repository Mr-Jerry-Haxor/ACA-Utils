import fs from 'node:fs';

const har = JSON.parse(fs.readFileSync('research data/scorecard-ui.tas-ewd.apps.boeing.com.har', 'utf8'));
const entries = har?.log?.entries ?? [];
const assets = entries.filter((entry) => {
  try {
    const url = new URL(entry.request.url);
    return entry.request.method === 'GET' && /\.(?:js|css)$/.test(url.pathname) && entry.response?.content?.text;
  } catch {
    return false;
  }
});
const focusTerm = process.argv.find((arg) => arg.startsWith('--term='))?.slice('--term='.length);
const terms = focusTerm ? [focusTerm] : ['app-side-nav-outer-toolbar', 'side-navigation-menu', 'dx-drawer', 'dx-treeview', 'navigation-list', 'menuItems', 'menuOpened', 'router-outlet'];
for (const entry of assets) {
  const url = new URL(entry.request.url);
  const text = entry.response.content.text;
  const found = [];
  for (const term of terms) {
    const lower = text.toLowerCase();
    let index = lower.indexOf(term);
    let count = 0;
    while (index >= 0 && count < (focusTerm ? 3 : 8)) {
      const before = focusTerm ? 900 : 180;
      const after = focusTerm ? 3200 : 240;
      found.push({ term, snippet: text.slice(Math.max(0, index - before), Math.min(text.length, index + term.length + after)).replace(/\s+/g, ' ') });
      index = lower.indexOf(term, index + term.length);
      count += 1;
    }
  }
  if (found.length) console.log(JSON.stringify({ asset: url.pathname, found }, null, 2));
}
