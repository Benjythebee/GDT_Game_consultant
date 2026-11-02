"""Back up Game Dev Tycoon saves and turn them into a snapshot the browser harness can load.

The game (Steam, Windows) keeps its saves in node-webkit's localStorage, an SQLite file:
    %LOCALAPPDATA%\\Game Dev Tycoon - Steam\\Local Storage\\file__0.localstorage
with keys like `slot_2` (the save), `2` (its header: company, cash, date), `general`, `settings`, `slot_knowledge`.
Steam Cloud keeps plain-file copies in Steam\\userdata\\<id>\\239820\\remote.

The live files are only ever copied, never opened: SQLite would roll back a leftover journal on open.

    python mods/dev/export_save.py                  # back up + snapshot into mods/dev/saves/<date>/
    python mods/dev/export_save.py --name my-backup   # choose the folder name
    python mods/dev/export_save.py --from mods/dev/saves/backup-2026-11-02   # snapshot an existing backup
    python mods/dev/export_save.py --from ... --company-name "My Company Corp"  # rename the company in the snapshot only

Then load it in the harness (python mods/dev/serve_game.py) with `await GDTDev.loadSave('<name>')`.
"""
import argparse
import datetime
import glob
import json
import os
import pathlib
import re
import shutil
import sqlite3
import tempfile

SAVES = pathlib.Path(__file__).resolve().parent / 'saves'
LOCAL = pathlib.Path(os.environ.get('LOCALAPPDATA', '')) / 'Game Dev Tycoon - Steam' / 'Local Storage'
DB = 'file__0.localstorage'


def read_items(folder):
    with tempfile.TemporaryDirectory() as tmp:
        for name in (DB, DB + '-journal'):
            if (folder / name).exists():
                shutil.copy2(folder / name, tmp)
        con = sqlite3.connect(os.path.join(tmp, DB))
        try:
            rows = con.execute('select key, value from ItemTable').fetchall()
        finally:
            con.close()
    return {k: v.decode('utf-16-le') if isinstance(v, bytes) else v for k, v in rows}


def rename(items, new_name):
    # company names come from the slot headers ("1", "2", "auto", "2L3", ...); they also appear inside the saves and
    # in some news texts, so replace the phrase everywhere (no quotes or backslashes in it, so the JSON stays valid)
    old = set()
    for key, value in items.items():
        if re.fullmatch(r'(\d+|auto)(L\d+)?', key):
            try:
                old.add(json.loads(value)['name'])
            except (ValueError, KeyError, TypeError):
                pass
    if any(c in new_name for c in '"\\'):
        raise SystemExit('The new name must not contain quotes or backslashes')
    for name in old:
        pattern = re.compile(re.escape(name), re.IGNORECASE)
        for key in items:
            items[key] = pattern.sub(new_name, items[key])
    print('Renamed', ', '.join(sorted(old)), 'to', new_name)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--name', default='backup-' + datetime.date.today().isoformat())
    parser.add_argument('--from', dest='source', help='an existing backup folder instead of the live saves')
    parser.add_argument('--company-name', help='rename the companies in the snapshot (the backup files keep the real name)')
    args = parser.parse_args()

    out = SAVES / args.name
    out.mkdir(parents=True, exist_ok=True)
    if args.source:
        source = pathlib.Path(args.source)
    else:
        for name in (DB, DB + '-journal'):
            if (LOCAL / name).exists():
                shutil.copy2(LOCAL / name, out)
        cloud = glob.glob(r'C:\Program Files (x86)\Steam\userdata\*\239820\remote')
        if cloud:
            shutil.copytree(cloud[0], out / 'steam-cloud', dirs_exist_ok=True)
        source = out
        print('Backed up', LOCAL, 'to', out)

    items = read_items(source)
    items.pop('slot_errorLogs', None)  # large and irrelevant
    if args.company_name:
        rename(items, args.company_name)
    (out / 'snapshot.json').write_text(json.dumps(items), encoding='utf-8')
    for key in sorted(k for k in items if k.isdigit() or k == 'auto'):
        try:
            h = json.loads(items[key])
            print('slot {0}: {1}, cash {2:,}, fans {3:,}, week {4:.0f}, saved {5}'.format(
                key, h['name'], h['cash'], h['fans'], h['currentWeek'], h['date']))
        except (ValueError, KeyError):
            pass
    print('Wrote', out / 'snapshot.json')


if __name__ == '__main__':
    main()
