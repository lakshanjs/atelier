# Atelier

A personal desktop furniture design app for Windows. Everything is a free panel or object: add boards, move and rotate them in 3D or flat views with snapping, then get a cut list, cutting plan and shopping list. It also imports whole houses from Sweet Home 3D to design furniture inside.

For one user (Lakshan), not hosted. Current version: **1.0.24**.

## Start here (next session)

- **Furniture libraries:** `.sh3f` import has only been tested on a file built by hand from the test house's models, not on a real downloaded library.
- **Example file:** `C:\Users\Lakshan\Desktop\myhome.atlr` is a full house saved in the app's own format. Its source is `C:\Users\Lakshan\Desktop\myhome.sh3d.zip`. It includes one test measurement along a wall, which can be deleted.
- **Open question for the user:** should dark be the default theme for new installs?

## Working with this user

- Keep answers short and in plain English. Sizes in **inches**.
- They often send changes mid-task, so check for messages and keep going.
- **Leave test windows open on screen** so they can watch. Never close them without being asked.
- **Don't force-close their Atelier to install.** Publish the build, install only if it's closed, otherwise ask them to close it.
- Style: looks like professional desktop software (Photoshop is their reference). Neutral colours. **Icon-only controls with hover tooltips** rather than text labels. No glowing or "AI look".
- Keep it generic: never add features for one furniture type.
- Yellow is reserved for the logo, the selection and its size labels.

## Project layout

There is no framework or bundler, and this folder is not a git repository.

| Path | What it is |
|---|---|
| `index.html` | The whole app: HTML, CSS and JS in one file (about 3,700 lines) |
| `main.js` | Electron window, single-instance lock, auto-update, opening a double-clicked `.atlr` |
| `preload.js` | Bridge for title bar colours and file opening (`window.atelierWin`) |
| `lib/` | three.js r128, OrbitControls, Lucide icon subset (`icons.js`), Barlow fonts, app icon |
| `scripts/publish-local.js` | Copies the build to the update folder |
| `old-box-version.html` | The rejected first version, kept for reference |
| `Corner rack - rounded.json` | The user's rack design with panel sizes rounded, in the older format |

`lib/icons.js` is a **subset** of Lucide. An icon name that isn't in it renders blank, so check with grep first.

## Build and release

```
npm run release
```

1. Raise `"version"` in `package.json` first, or the update won't be offered.
2. This builds the NSIS installer in `dist\` and copies it to `D:\wamp\www\atelier-updates`.
3. The installed app checks `http://localhost/atelier-updates/` shortly after launch, downloads the update, and installs it on quit. WAMP must be running.

To install directly: `dist\Atelier Setup <version>.exe /S`. It installs to `%LOCALAPPDATA%\Programs\Atelier`. Installing closes a running copy, so check first.

Dev servers such as WAMP belong to OnCodes Dev Service Manager. Don't start or stop them from a shell.

## How the data works

- **`P`** is the project: `items`, `groups` (shown as "Layers"), `levels`, `dims`, `unit` and so on. All lengths are stored in **mm**.
- **`edit(fn)`** is how changes are made. Every undo step stringifies all of `P`, so **never put large data in `P`**.
- **Autosave** writes `P` to localStorage (`furniture-panels-2`). Electron's storage is separate from Chrome's.
- **Models and textures** live in the runtime `MODELS` and `TEXTURES` maps and in IndexedDB (`furniture-files`, keys `model:*` and `tex:*`). Items only hold keys to them.
- **Library (My items):** `{ folders, items }` in IndexedDB under the key `library`, moved from the old localStorage key `furniture-library` the first time it loads. Entries hold `items`, `size`, `folder` and a small `thumb` image, and only point at models by key. Removing an entry leaves its model and textures in IndexedDB.
- **Items:** `kind: 'panel'` goes on the cut list. `kind: 'object'` doesn't. `isRoomPart` covers walls and floors. Local axes: `l`→x, `t`→y, `w`→z.
- **Naming:** the UI says "Layers", while the code and data still say `group`. Old storage keys still say `furniture-*`. Both are deliberate, to keep existing saves working.

## File format: `.atlr`

A zip file, handled by `atelierBytes()` and `openBytes()` in `index.html`:

- `project.json`: `{ format: 'atelier', version: 1, project, view, models, textures }`
- `models/<m>/<part>.p|n|i|u`: positions (Int16, -1 to 1), normals (Int8), indices (Uint32), UVs (Float32)
- `textures/<n>`: original image bytes

Older `.json` projects still open, and saving one prompts for a new `.atlr`. Raise `version` if the format changes in a way old apps can't read. They refuse newer files.

## File format: `.atlib`

A saved library, written by `libPackBytes()` and read by `libTakePack()`. A zip with:

- `library.json`: `{ format: 'atelier-library', version: 1, folders, items, models, textures }`
- `models/<n>`: one file per model, its parts' arrays end to end, with their byte lengths in `parts[].len`. One file each because a zip made here is limited to 65,535 files.
- `textures/<n>`: original image bytes

## Main features

- **Measuring:** snaps to corners and anywhere along panel edges. Lines stay on X, Y or Z. Drag a dot to move an end, or click it to measure on from there. Typing a length moves the selected object attached to that end. Each measurement can be hidden on its own.
- **Scaling:** squares on both sides. The dragged side moves and the other stays fixed, and Shift grows both ways. Snaps to other objects' faces and to sizes other objects already have. Alt turns snapping off.
- **Units:** mm, cm, m, inches, feet, yards. Any size box accepts any unit, like `120cm` or `5' 3 1/2"`.
- **Layers tab:** levels are parents of layers. Levels can be hidden, shown on their own ("Only"), locked, renamed, added and removed, and layers can be moved between them. Levels only organise things and don't change heights.
- **Sweet Home 3D import:** walls with real openings, side colours and textures; rooms as floors and ceilings with their real outlines and textures; stair holes; all OBJ models with colours and textures.
- **Library:** File > Import to library takes an OBJ model in a zip, a `.sh3f` furniture library, a `.sh3d` home or an `.atlib`, without touching the open project. Pieces already there are skipped. Folders can be added, renamed by double-click, and items dragged onto them. The gallery filter shows all, stock, imported or saved items, and works with search. An entry counts as imported if it uses a 3D model.
- **Toolbar:** drag any menu item onto it, drag along it to reorder, drag off to remove. Right-click for separators. **View > Reset toolbar** restores it. Stored per user in localStorage (`atelier-toolbar`).
- **Window:** no Windows title bar. The app's title bar uses real Windows buttons drawn over it (`titleBarOverlay`, `BAR_HEIGHT` in `main.js`, 33 px under a 34 px bar so the border shows).

## Known limits and things to check

**Not done**
- The Sweet Home 3D import is one-way: Atelier can't save back to it.
- A plain OBJ doesn't say what unit it uses, so `libGuessMm()` picks the first of cm, mm, m, feet or inches that gives a likely size. It may be wrong, and it can be scaled once placed.
- A plain OBJ's front may face any way, because it has no rotation data.
- Library import reads OBJ models only. Other formats in a `.sh3f` are counted as couldn't be read.
- Doors and windows added from the library don't cut an opening in a wall.
- Baseboards aren't imported. The test house has none.
- Textures set on a whole piece use the model's own mapping, so some may look a different scale than in Sweet Home 3D.
- Selected thickness names stay as written (like `3/4"`) in every unit.
- Roof and tree groups are matched by words in piece names (`toit|roof|skylight`, `tree|palm|shrub|bush|suv`).

**Built but only partly tested**
- Toolbar dragging was tested with simulated drags, not by hand.
- Double-clicking an `.atlr` in Explorer: the file type is registered and launching with a file works, but a real double-click wasn't tried.
- The taskbar name: the window title is right (`myhome.atlr - Atelier`), but the taskbar itself couldn't be seen.
- The Windows buttons and the title bar border can't be captured in screenshots, so the user has to confirm those.
- Renaming a level and locking a whole level weren't exercised.

**In the test house, by design**
- Only 1 stair hole is cut, because only the straight staircase reaches Level 1. The spiral stops about 26" below that floor, which may be a mistake in the user's original file. They were asked whether it should reach Level 1 and haven't answered.

## Testing

A running copy can be driven and screenshotted over the Chrome DevTools Protocol. To run alongside the user's Atelier, it needs its own data folder, because of the single-instance lock. Make a small launcher folder with this as `main.js` and a `package.json` pointing at it:

```js
const { app } = require('electron');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.setPath('userData', 'C:/path/to/some/temp/folder');
require('D:/playground/atelier/main.js');
```

```
node_modules\electron\dist\electron.exe <launcher folder> --remote-debugging-port=9336 [file.atlr]
```

- Read pages from `http://127.0.0.1:9336/json`, then use `Runtime.evaluate` over the WebSocket. App globals like `P`, `MODELS` and `render()` are reachable.
- Without those two switches, the renderer pauses when the window is covered, and screenshots hang.
- `DOM.setFileInputFiles` on `#sh3dIn` or `#fileIn` loads a file without the native dialog.
- Large results can break the connection, so fetch big data in pieces of about 3 MB.
- Reloading picks up `index.html` changes. Changes to `main.js` or `preload.js` need a restart.
- Don't test in a window the user is working in. A reload loses their undo history.
- Native file dialogs and the Windows buttons can't be driven this way.
