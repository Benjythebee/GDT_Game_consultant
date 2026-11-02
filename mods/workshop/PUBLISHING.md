# Publishing Game Consultant to the Steam Workshop

Everything the Workshop page needs is in this folder; the mod itself is `mods/game-consultant`
(`package.json`, `consultant.js`, `image.png`, nothing else, because the whole folder is uploaded).

| File | Use |
|---|---|
| `../game-consultant/image.png` | Preview image (512x512). Also shown in the game's Mods list. |
| `description.bbcode.txt` | Workshop description (Steam BBCode, < 8000 characters). |
| `screenshots/*.png` | 1600x900 in-game screenshots for the Workshop gallery. |

## Before publishing

1. Play a few games with the new version in the real game: the browser harness runs a modern Chrome, the game runs
   Chromium 30. (1.1.0 was played in the real game on 2026-11-02.)
2. Check `package.json`: version, description and `url` (it points at GitHub; remove it if the repo isn't public).

## Publish (first time)

1. Start the game, main menu, **Mods**, **Publish Mod**.
2. **Mod Source Folder**: `D:\SteamLibrary\steamapps\common\Game Dev Tycoon\mods\game-consultant` (the linked folder).
   Title and description are filled from `package.json`.
3. Replace the description with the contents of `description.bbcode.txt`.
4. **Choose Image**: `mods\game-consultant\image.png`.
5. Read the Modding Agreement and the Workshop terms linked under the form, then **Publish**.
6. On the item's Steam page (Steam overlay or browser): **Add/edit images & videos** to upload `screenshots/*.png`,
   pick tags, and switch visibility to Public when ready (new items may start hidden or friends-only).

Subscribed Workshop mods are installed into `mods_ws` and win over the linked `mods/game-consultant` when their version
is equal or newer, so bump `version` in `package.json` before each update.

## Update

Main menu, **Mods**, **Update Mod**, pick Game Consultant, choose the same folder, describe the changes, **Update**.

## Regenerate the media

```
python mods/dev/export_save.py --from mods/dev/saves/backup-2026-11-02 --name backup-2026-11-02 --company-name "My Company Corp"
node mods/dev/screenshots.mjs        # starts the harness if needed, writes screenshots/*.png
python mods/dev/make_preview.py      # image.png from screenshots/02-perfect-combo.png
```
