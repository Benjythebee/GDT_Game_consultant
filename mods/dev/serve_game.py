"""Run the installed Game Dev Tycoon in a normal browser to test mods without restarting the game.

Serves the game folder read-only on http://localhost:8766/ and
- injects a stub for NW.js `require` (fs, path, nw.gui, ...) into defaultBrowser.html,
- serves this repo's mods/ folder under /__mods/ and loads every mod listed in DEV_MODS after the game scripts.

Saves go to the browser's localStorage, never to the real save files. Steam features are unavailable.

    python mods/dev/serve_game.py [--game "D:/SteamLibrary/steamapps/common/Game Dev Tycoon"] [--port 8766]
"""
import argparse
import http.server
import json
import os
import pathlib

MODS_DIR = pathlib.Path(__file__).resolve().parent.parent
DEV_MODS = ['dev/dev_tools.js', 'game-consultant/consultant.js']

SHIM = r"""<script>
(function () {
  var noop = function () {};
  window.process = { execPath: '/nw.exe', platform: 'win32', env: {}, versions: {}, umask: function () { return 0; } };
  var win = { on: noop, once: noop, removeAllListeners: noop, enterFullscreen: noop, leaveFullscreen: noop,
    toggleFullscreen: noop, isFullscreen: false, maximize: noop, show: noop, focus: noop, reload: function () { location.reload(); },
    close: noop, showDevTools: noop, setResizable: noop, resizeTo: noop, moveTo: noop, setMinimumSize: noop, zoomLevel: 0 };
  var gui = { Window: { get: function () { return win; } }, App: { closeAllWindows: noop, clearCache: noop, argv: [], on: noop },
    Shell: { openExternal: function (u) { window.open(u); } }, Menu: function () { return { append: noop, createMacBuiltin: noop, items: [] }; },
    MenuItem: function () {} };
  var fs = { existsSync: function () { return false; }, readdirSync: function () { return []; },
    readFileSync: function () { throw new Error('fs stub'); }, writeFileSync: noop, unlinkSync: noop, mkdirSync: noop,
    mkdir: function (p, m, cb) { (typeof m === 'function' ? m : cb || noop)(null); },
    stat: function (p, cb) { cb(new Error('fs stub')); } };
  var path = { sep: '/', dirname: function (p) { return String(p).replace(/[\\/][^\\/]*$/, ''); },
    resolve: function (p) { return p; }, join: function () { return [].slice.call(arguments).join('/'); },
    basename: function (p) { return String(p).replace(/^.*[\\/]/, ''); } };
  window.require = function (name) {
    if (name === 'nw.gui') return gui;
    if (name === 'fs') return fs;
    if (name === 'path') return path;
    if (/bluebird/.test(name)) return Promise;
    throw new Error('Cannot find module ' + name);
  };
})();
</script>
"""


class Handler(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        clean = path.split('?', 1)[0].split('#', 1)[0]
        if clean.startswith('/__mods/'):
            return str(MODS_DIR / clean[len('/__mods/'):])
        return super().translate_path(path)

    def do_GET(self):
        if self.path.split('?', 1)[0] in ('/', '/defaultBrowser.html'):
            html = (pathlib.Path(self.directory) / 'defaultBrowser.html').read_text(encoding='utf-8-sig')
            html = html.replace('<script', SHIM + '<script', 1)
            # The game re-renders <body> through jQuery (which re-runs its scripts), so mods are added from <head>
            # once the page has loaded, like the game's own mod loader does after start-up.
            loader = ('<script>window.addEventListener("load", function () {{ {0}.forEach(function (src) {{'
                      ' var s = document.createElement("script"); s.src = "/__mods/" + src; s.async = false;'
                      ' document.head.appendChild(s); }}); }});</script>').format(json.dumps(DEV_MODS))
            html = html.replace('</head>', loader + '</head>', 1)
            body = html.encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def end_headers(self):
        if self.path.startswith('/__mods/'):
            self.send_header('Cache-Control', 'no-store')
        super().end_headers()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--game', default=os.environ.get('GDT_DIR', 'D:/SteamLibrary/steamapps/common/Game Dev Tycoon'))
    parser.add_argument('--port', type=int, default=8766)
    args = parser.parse_args()
    handler = lambda *a, **kw: Handler(*a, directory=args.game, **kw)
    print('Serving {0} on http://localhost:{1}/'.format(args.game, args.port))
    http.server.ThreadingHTTPServer(('127.0.0.1', args.port), handler).serve_forever()


if __name__ == '__main__':
    main()
