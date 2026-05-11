/**
 * Writes single-file HTML snapshots under standalone-html/
 * (structure + all CSS inlined). No JS — for reuse outside Vite.
 *
 * Run: node scripts/build-standalone-html.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const outDir = path.join(root, 'standalone-html');

function read(p) {
  return fs.readFileSync(path.join(root, p), 'utf8');
}

/** Avoid closing the HTML style element if CSS ever contained that substring. */
function guardStyleClose(css) {
  return css.replace(/<\/style>/gi, '<\\/style>');
}

function buildPage({ fileName, title, bodyLines, cssFiles }) {
  const css = cssFiles.map((f) => read(f)).map(guardStyleClose).join('\n\n/* ----- next sheet ----- */\n\n');
  const body = bodyLines.join('\n');
  const styleBlock =
    css.trim().length > 0
      ? `  <style>
${css}
  </style>
`
      : '';
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
${styleBlock}</head>
<body>
${body}
  <!-- No script: portable HTML/CSS only. Real slot loads via Vite + Preact. -->
</body>
</html>
`;
  const out = path.join(outDir, fileName);
  fs.writeFileSync(out, html, 'utf8');
  console.log('wrote', path.relative(root, out));
}

fs.mkdirSync(outDir, { recursive: true });

buildPage({
  fileName: 'mainGameFun.html',
  title: 'Director · mainGameFun (standalone)',
  bodyLines: ['  <div id="app"></div>'],
  cssFiles: ['src/slots/mainGameFun/main.css'],
});

buildPage({
  fileName: 'videoDecorativeOverlay.html',
  title: 'Director · videoDecorativeOverlay (standalone)',
  bodyLines: ['  <div id="app"></div>'],
  cssFiles: ['src/slots/videoDecorativeOverlay/main.css'],
});

/* settings: merge root inline snippet + bundled settings CSS */
const settingsRoot = read('settings.html');
const inlineExtra = [];
const re = /<style>([\s\S]*?)<\/style>/g;
let m;
while ((m = re.exec(settingsRoot)) !== null) {
  inlineExtra.push(m[1].trim());
}
const settingsCss = [read('src/slots/settings/main.css'), ...inlineExtra].join('\n\n');
{
  const css = guardStyleClose(settingsCss);
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Director · settings (standalone)</title>
  <style>
${css}
  </style>
</head>
<body>
  <div id="app"></div>
  <!-- No script: portable HTML/CSS only. Real settings loads via Vite + Preact. -->
</body>
</html>
`;
  fs.writeFileSync(path.join(outDir, 'settings.html'), html, 'utf8');
  console.log('wrote', path.relative(root, path.join(outDir, 'settings.html')));
}

buildPage({
  fileName: 'backgroundModel.html',
  title: 'Director · model background (standalone)',
  bodyLines: [
    '  <!-- No UI: background slot runs TypeScript only in production. -->',
    '  <p style="font: 12px system-ui; opacity: 0.6; padding: 12px;">Model background entry has no stylesheet in this repo.</p>',
  ],
  cssFiles: [],
});

buildPage({
  fileName: 'backgroundViewer.html',
  title: 'Director · viewer background (standalone)',
  bodyLines: [
    '  <!-- No UI: background slot runs TypeScript only in production. -->',
    '  <p style="font: 12px system-ui; opacity: 0.6; padding: 12px;">Viewer background entry has no stylesheet in this repo.</p>',
  ],
  cssFiles: [],
});

const mocksCss = [
  read('src/slots/mainGameFun/main.css'),
  read('src/slots/rightOverlay/main.css'),
  read('src/slots/settings/main.css'),
]
  .map(guardStyleClose)
  .join('\n\n/* ----- next sheet ----- */\n\n');

{
  const html = `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Director · UI playground (standalone)</title>
  <style>
${mocksCss}
  </style>
</head>
<body>
  <div id="app"></div>
  <!-- No script: portable HTML/CSS only. Playground loads via Vite + mocks mode. -->
</body>
</html>
`;
  fs.writeFileSync(path.join(outDir, 'mocks.html'), html, 'utf8');
  console.log('wrote', path.relative(root, path.join(outDir, 'mocks.html')));
}

console.log('Done. Output:', path.relative(root, outDir));
