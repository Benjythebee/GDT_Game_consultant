# Game Dev Tycoon Helper

A small static web page that helps plan games in Game Dev Tycoon. Pick a topic, genre, audience or platform and every
other list is re-rated against your picks; bad and terrible matches are hidden. Once a genre is picked it also shows
the target Tech/Design ratio, the slider priorities for each development stage, and which engine features are worth
adding (features in areas your genre neglects are mostly wasted money).

## Use

Open `index.html` in a browser (no build step, no server needed). The current picks are kept in the URL hash, so a link
can be bookmarked or shared.

## In-game mod: Game Consultant

`mods/game-consultant` brings the same advice into the game itself: rated and filterable topic / genre / audience /
platform lists, a **Create perfect combo automatically** button, and slider recommendations for every development
stage. See [mods/README.md](mods/README.md) for what it does, how to install it and how to develop mods.

## Data

`data.js` is generated from the tables on the wiki page
[Game Development Based on Experience/1.4.3](https://gamedevtycoon.fandom.com/wiki/Game_Development_Based_on_Experience/1.4.3)
and [Custom Game Engine](https://gamedevtycoon.fandom.com/wiki/Custom_Game_Engine).
To refresh it:

```
python scripts/build_data.py
```
