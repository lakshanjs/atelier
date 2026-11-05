# Atelier

A personal desktop furniture design app for Windows. Everything is a free panel or object: add boards, move and rotate them in 3D or flat views with snapping, then get a cut list, cutting plan and shopping list. It also imports whole houses from Sweet Home 3D to design furniture inside.

For one user (Lakshan), not hosted. Current version: **1.0.25**.

## Start here (next session)

- **Never cut from the G-code without simulating it first.** It's only been checked by the tests' own reader, never on a machine. The hole sizes for hinges, cams and slides are common defaults, to be matched to the hardware actually bought.
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

There is no framework or bundler. The scripts in `src/` are plain scripts loaded in order and share one scope, so their order in `index.html` matters only for code that runs at load. Changes are in git; run `npm test` before committing.

| Path | What it is |
|---|---|
| `index.html` | The page: its HTML and the list of scripts |
| `src/app.css` | All styles |
| `src/model.js`, `edit.js`, `formulas.js` | Items, undo and units; parameters, formulas and Make resizable |
| `src/view3d.js`, `flat.js`, `properties.js` | 3D, flat views, the side panel |
| `src/cutlist.js`, `machining.js`, `hardware.js`, `drawings.js` | Cut list and checks; holes, DXF and G-code; hinges and slides; workshop drawings |
| `src/library.js`, `files.js`, `safety.js`, `ui.js` | My items; saving and imports; autosave and versions; menus and start-up |
| `test/` | Tests that drive the real app (`npm test`), each with its own empty data folder |
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
- **Autosave** writes `P` to localStorage (`furniture-panels-2`) and, shortly after, to IndexedDB (`autosave`), which wins if it's newer or the first is full. Electron's storage is separate from Chrome's.
- **Versions** are in IndexedDB (`snaps`, `snap:<time>`): the last 40 automatic ones plus every named one.
- **Crash note:** `main.js` keeps `running.lock` in the data folder while running. Script errors go in `errors.log` beside it.
- **Formulas:** see the top of `src/formulas.js`. `persist()` runs `fxUpdate()`: a value changed by hand loses its formula, and a whole layer moved together shifts its Left, Floor and Back instead.
- **Machining** is worked out from how panels touch and never stored, except holes and grooves added by hand (`it.ops`). Settings are in `P.mach` and `P.cncTool`, with defaults at the top of `src/machining.js`.
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
- **Editable designs:** select parts and use Make resizable to get Width, Height and Depth. Any size or position box takes a formula like `=Width-36`; a plain number in one takes the project's unit, and sums like `800-36` are worked out once. Copies and library items of a whole resizable layer get their own parameters.
- **Machining:** joints, hinges, shelf pins and slides drill themselves. Holes and grooves can be added by hand in Properties.
- **CNC:** File > Export for CNC gives a zip with a DXF and G-code per sheet, plus a CSV of what must be done by hand: edge holes and the other side. The DXF's layer names say what to do, like `DRILL_D5_Z12`.
- **Workshop drawings:** A3 or A4 (`P.drawing.paper`): views, sections, exploded view with parts list, and each different part with its holes. Save PDF uses `printToPDF`.
- **Version history:** File > Version history.
- **Hardware catalogue:** File > Hardware catalogue lists hinges and slides with their drilling, lengths and prices, kept in IndexedDB (`hardware`). Choose per project or per door and drawer. Each project keeps a copy of what it uses (`P.hwUsed`), so files stay correct on another computer. The starting entries are generic values, not any maker's specification.
- **Precision:** during a drag, or right after it, type a number and press Enter for an exact move, size, turn or scale. X, Y or Z holds a move to that direction, and Esc cancels a drag. Move by and Turn by are in Properties, with an angle snap setting (Shift gives 90°) and Lock this angle. Guides (`P.cguides`) come from dragging off a flat view's ruler; drag one back onto a ruler to delete it. The readout names what a drag snapped to, and that item is outlined.
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
- Turning a resizable part stops its position formulas. Make resizable only understands straight parts: angled ones just keep their size.
- Rectangular and round cut-outs and corners stay measured from the panel's centre when it's resized.
- Part drawings show holes on the top and bottom faces from above, and edge holes as ticks. There's no separate edge view.
- G-code machines one side. Edge holes and the other side are listed in the CSV. Parts are held by a thin skin, not tabs.
- Slides are modelled as side-mounted, with screws in a line at the drawer's mid height. Undermount slides aren't.
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
