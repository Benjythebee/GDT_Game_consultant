// Takes full-resolution screenshots of the mod inside the game for the Steam Workshop page.
// Runs the browser harness (serve_game.py) in headless Chrome/Edge through the DevTools protocol, loads a save snapshot
// fresh for every scene and drives the game with the GDTDev helpers. Uses a throwaway browser profile, so no real save
// is touched.
//   node mods/dev/screenshots.mjs [--save backup-2026-11-02] [--size 1600x900] [--out mods/workshop/screenshots] [--only 04]
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name, def) => {
  const i = process.argv.indexOf('--' + name);
  return i > 0 ? process.argv[i + 1] : def;
};
const save = arg('save', 'backup-2026-11-02');
const [width, height] = arg('size', '1600x900').split('x').map(Number);
const out = resolve(arg('out', join(here, '..', 'workshop', 'screenshots')));
const only = arg('only', '');
const PORT = 8766;
const DEBUG_PORT = 9333;
const GAME = `http://localhost:${PORT}/`;

const browsers = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Each scene starts from a freshly loaded save and ends with the state to capture.
const scenes = [
  ['01-topic-ratings', `
    await GDTDev.openConcept();
    $('.simplemodal-data .gameSizeMedium').click(); await w(400);
    $('.gc-card .gc-filter').prop('checked', true).trigger('change');
    UI.pickTopicClick(); await w(900);
    $('.gc-card .gc-filter').prop('checked', false).trigger('change');`],
  ['02-perfect-combo', `
    await GDTDev.openConcept();
    $('.simplemodal-data .gameSizeMedium').click(); await w(400);
    $('.gc-card .gc-auto').click(); await w(900);`],
  ['03-platforms-filtered', `
    await GDTDev.openConcept();
    $('.simplemodal-data .gameSizeMedium').click(); await w(300);
    $('.gc-card .gc-auto').click(); await w(500);
    $('.gc-card .gc-filter').prop('checked', true).trigger('change');
    UI.pickPlatformClick($('.simplemodal-data #pickPlatformButton')); await w(900);
    $('.gc-card .gc-filter').prop('checked', false).trigger('change');`],
  ['04-stage-and-staff', `
    await GDTDev.openConcept();
    $('.simplemodal-data .gameSizeMedium').click(); await w(300);
    $('.gc-card .gc-auto').click(); await w(500);
    $('.simplemodal-data .dialogNextButton').click(); await w(1500);
    UI.closeGameDefinition(); await w(2000);
    await GDTDev.openStage(1, { d: 60, t: 70 });
    $('.gc-stage .gc-apply').click(); await w(1200);`],
  ['05-sequel-advice', `
    await GDTDev.openSequel(); await w(600);
    $('.gc-seq-card .gc-seq-pick').first().click(); await w(1200);`],
  ['06-publishing-deals', `
    await GDTDev.openPublishingDeals(); await w(1200);`]
];

const serverUp = async () => {
  try {
    return (await fetch(GAME + '__mods/game-consultant/package.json')).ok;
  } catch (e) {
    return false;
  }
};

async function main() {
  const browser = browsers.find(existsSync);
  if (!browser) throw new Error('No Chrome or Edge found');
  mkdirSync(out, { recursive: true });

  let server = null;
  if (!(await serverUp())) {
    server = spawn('python', [join(here, 'serve_game.py'), '--port', String(PORT)], { stdio: 'ignore' });
    for (let i = 0; i < 40 && !(await serverUp()); i++) await wait(250);
  }

  const profile = mkdtempSync(join(tmpdir(), 'gdt-shots-'));
  const chrome = spawn(browser, [
    '--headless=new', `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`,
    `--window-size=${width},${height}`, '--hide-scrollbars', '--mute-audio', '--no-first-run', 'about:blank'
  ], { stdio: 'ignore' });

  let targets = null;
  for (let i = 0; i < 60 && !targets; i++) {
    try {
      targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json();
    } catch (e) {
      await wait(250);
    }
  }
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let nextId = 0;
  const pending = new Map();
  const listeners = [];
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    } else if (msg.method) listeners.forEach((l) => l(msg));
  });
  const send = (method, params = {}) => new Promise((r) => {
    const id = ++nextId;
    pending.set(id, r);
    ws.send(JSON.stringify({ id, method, params }));
  });
  const loaded = () => new Promise((r) => {
    const l = (m) => {
      if (m.method === 'Page.loadEventFired') {
        listeners.splice(listeners.indexOf(l), 1);
        r();
      }
    };
    listeners.push(l);
  });
  const run = async (body) => {
    const res = await send('Runtime.evaluate', {
      expression: `(async () => { const w = (ms) => new Promise((r) => setTimeout(r, ms));
        for (let i = 0; i < 60 && typeof GDTDev === 'undefined'; i++) await w(250);
        ${body} })()`,
      awaitPromise: true,
      returnByValue: true
    });
    if (res.result && res.result.exceptionDetails) throw new Error(JSON.stringify(res.result.exceptionDetails).slice(0, 400));
    return res.result && res.result.result && res.result.result.value;
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });

  try {
    for (const [name, script] of scenes) {
      if (only && !name.startsWith(only)) continue;
      let ready = loaded();
      await send('Page.navigate', { url: GAME });
      await ready;
      ready = loaded();
      run(`GDTDev.loadSave(${JSON.stringify(save)});`).catch(() => {}); // reloads the page
      await ready;
      const company = await run('const r = await GDTDev.continueGame(); return r.name;');
      await run(script);
      await wait(300);
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(out, name + '.png'), Buffer.from(shot.result.data, 'base64'));
      console.log(`${name}.png (${company})`);
    }
  } finally {
    ws.close();
    chrome.kill();
    if (server) server.kill();
    await wait(500);
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch (e) {}
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
