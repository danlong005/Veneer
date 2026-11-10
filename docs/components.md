# Ready-made components

Components are small programs that draw something a screen definition can't: a chart, a
map, every row of a list at once, a camera scanner. Veneer comes with sixteen of them.
This guide covers installing them, placing one on a screen, and each one's options and
use. For writing your own, see [Custom components](../README.md#custom-components).

| Component | File | Shows | Needs beside it |
| --- | --- | --- | --- |
| [Whole-list table](#whole-list-table) | `list-table.js` | Every row of a list in one table, to sort, filter and search | `lib/` |
| [Totals](#totals) | `totals.js` | Count, sum, average, lowest or highest of a list's columns | `lib/` |
| [Chart](#chart) | `bar-chart.js` | A list's columns as bars, stacked bars, lines, a pie or donut, or a sparkline | `lib/` |
| [Board](#board) | `board.js` | A list's rows as cards in a column per status | `cards.js`, `lib/` |
| [Calendar](#calendar) | `calendar.js` | A list's rows on a month or week calendar | `lib/` |
| [Tree](#tree) | `tree.js` | An indented list as a tree that opens and closes | `lib/` |
| [Pin map](#pin-map) | `pin-map.js` | Every row of a list as a pin on one map | `map.js`, `lib/` |
| [Cards](#cards) | `cards.js` | A list as cards, one per row | |
| [Spool file](#spool-file) | `spool.js` | A spooled file as one document to scroll, search and download | |
| [Barcode scanner](#barcode-scanner) | `scanner.js` | A camera button beside a field that types what it reads | |
| [Help panel](#help-panel) | `help-panel.js` | Help for the screen, written in Markdown, opened by F1 | |
| [Embedded page](#embedded-page) | `embed.js` | A page from another system, its address built from the screen | |
| [Status timeline](#status-timeline) | `timeline.js` | A status as steps (Ordered → Shipped → Delivered) | |
| [Map](#map) | `map.js` | An address from the screen on a map | |
| [Star rating](#star-rating) | `star-rating.js` | A one-digit field as stars | |

**Contents:** [Try them in the demo](#try-them-in-the-demo) · [Installing](#installing) ·
[Placing a component](#placing-a-component) · [The page or the whole list](#the-page-or-the-whole-list) ·
each component above · [Troubleshooting](#troubleshooting)

## Try them in the demo

`npm run demo` (after `npm run build`) has every component on a screen, each from a
definition file you can copy: sign on with any name, then type the menu option. In the
designer (**Design**), select a component's box to see and change its options. The files
are in [`packages/server/dev/screens/`](https://github.com/danlong005/Veneer/blob/main/packages/server/dev/screens).

| Component | Menu option | Definition |
| --- | --- | --- |
| Whole-list table, totals | 1 or `WRKACTJOB` | [`demo-active-jobs.json`](https://github.com/danlong005/Veneer/blob/main/packages/server/dev/screens/demo-active-jobs.json) |
| Totals (with output displays on the list) | 11 | [`demo-orders.json`](https://github.com/danlong005/Veneer/blob/main/packages/server/dev/screens/demo-orders.json) |
| Calendar | 12 | [`demo-orders-calendar.json`](https://github.com/danlong005/Veneer/blob/main/packages/server/dev/screens/demo-orders-calendar.json) |
| Board | 13 | [`demo-orders-board.json`](https://github.com/danlong005/Veneer/blob/main/packages/server/dev/screens/demo-orders-board.json) |
| Chart (bars and a donut) | 14 | [`demo-orders-chart.json`](https://github.com/danlong005/Veneer/blob/main/packages/server/dev/screens/demo-orders-chart.json) |
| Status timeline, embedded page, barcode scanner, help panel (F1) | 15 | [`demo-order-status.json`](https://github.com/danlong005/Veneer/blob/main/packages/server/dev/screens/demo-order-status.json) |
| Star rating | 16 | [`demo-delivery-options.json`](https://github.com/danlong005/Veneer/blob/main/packages/server/dev/screens/demo-delivery-options.json) |
| Tree | 17 | [`demo-bill-of-materials.json`](https://github.com/danlong005/Veneer/blob/main/packages/server/dev/screens/demo-bill-of-materials.json) |
| Pin map | 18 | [`demo-contacts-map.json`](https://github.com/danlong005/Veneer/blob/main/packages/server/dev/screens/demo-contacts-map.json) |
| Cards | 4 | [`demo-contacts.json`](https://github.com/danlong005/Veneer/blob/main/packages/server/dev/screens/demo-contacts.json) |
| Map | 3 | [`demo-customer-addresses.json`](https://github.com/danlong005/Veneer/blob/main/packages/server/dev/screens/demo-customer-addresses.json) |
| Spool file | `DSPSPLF` | [`demo-spool-file.json`](https://github.com/danlong005/Veneer/blob/main/packages/server/dev/screens/demo-spool-file.json) |

The embedded page on option 15 is a packing list from a small web server the demo starts
on `http://127.0.0.1:8079`, standing in for another system; it shows in browsers on the
same machine. The maps and pin map look addresses up with OpenStreetMap, so they need
internet. The scanner's camera button needs a browser with a barcode detector and HTTPS
([Barcode scanner](#barcode-scanner)).

## Installing

The components are in `examples/components/` of the release (in the repo,
`packages/server/dev/components/`). Copy the ones you want, with what they need beside them
(the table above), into the server's components folder (`VENEER_COMPONENTS_DIR`; see
[Ready-made components](../README.md#ready-made-components) for where it is on each kind of
install), then restart Veneer.

`lib/` is a folder of shared code, not a component. Copy the whole folder, keeping its name:

```sh
# IBM i (QSH or SSH): the whole-list table and the totals
cd /QOpenSys/opt/veneer/current/examples/components
mkdir -p /QOpenSys/etc/veneer/components
cp -R list-table.js totals.js lib /QOpenSys/etc/veneer/components/
```

To try them first, run `npm run demo` from the repo: it uses every component, and its
screens show some of them (WRKACTJOB: the whole-list table and totals; DSPSPLF: the spool
file viewer; option 4: cards; option 3: maps).

## Placing a component

**In the designer** (see [the designer guide](designer.md)):

1. Open the screen in Veneer and click **Design**.
2. In the **Page** tab's **Components** section, pick the component and click **Add
   component**. (A component that takes a field's place, such as the barcode scanner: select
   the field and choose **Show as: Component**.)
3. Drag the box where it goes and drag its corner to size it, or set **Row**, **Column**,
   **Width** and **Height** in the **Selected** tab.
4. Type its **Options (JSON)**, such as `{ "column": "Status" }`. The box redraws as you type;
   a mistake in an option shows in the box.
5. To have a component take a list's place, select the list and click **Hide**, and hide its
   option legend ("2=Change 4=Delete…") and its More.../Bottom marker the same way.
6. **Preview**, then **Save**.

**In a definition file**, a component is a `component` change:

```json
{ "op": "component", "name": "list-table", "at": { "row": 6, "col": 2 }, "width": 79, "height": 12,
  "options": { "filters": ["Status"], "default": "5" } }
```

`name` is the file name without `.js`. `at` is the box's top-left cell, and `width` and
`height` are in screen columns and rows. Components draw over the screen's text, but text
under a box with gaps (a row of tiles, for example) shows through them, so hide it.

Columns in options are found by their heading on the screen ("Status", "CPU %"), ignoring
case. Options in a list (`"columns": ["Order", "Status"]`) are JSON arrays.

## The page or the whole list

Components that show a list take a `"list"` option:

- **`"all"`** reads the whole list when the screen shows, the way **Export** does: it pages to
  the top, down to the bottom, then back to the page the user was on. A long list shows
  Export's progress and **Cancel (Esc)**; a short one reads without a dialog. Every
  component on the screen gets the same reading, so a whole-list table and totals read the
  list once.
- **`"page"`** shows only the page showing. Paging redraws it.

With the whole list, an option on a row (a button, or clicking the row) pages back to that
row, types the option into it and presses Enter, just as a user would. If the list has
changed since it was read (the row isn't where it was), Veneer says so and the component
reads the list again. Paging with Page Up and Page Down still works; the component notices a
page it hasn't read (a row was added or deleted) and reads the list again.

The list is read only when there are no unsent changes on the screen (as for Export). In the
designer no keys are sent, so these components show the page showing, with a note.

`maxPages` (default 100) stops reading a very long list; the component says when it did.
Searching on the host first, for a smaller list, works better than reading thousands of
rows.

## Whole-list table

Every row of a list in one table, to sort, filter and search, instead of one page at a time.
Clicking a heading sorts by it (again reverses it); columns of numbers and dates sort as
numbers and dates.

```json
{ "op": "component", "name": "list-table", "at": { "row": 6, "col": 2 }, "width": 79, "height": 14,
  "options": { "columns": ["Job", "User", "Status"], "filters": ["Status"], "sort": "-CPU %",
               "actions": ["5", "4"], "default": "5" } }
```

| Option | What it does | Default |
| --- | --- | --- |
| `columns` | The columns to show, in order | Every column except the option column |
| `search` | `false` hides the search box | Shown |
| `filters` | Columns to offer a drop-down of their values | None |
| `sort` | The column to sort by at first; `"-Status"` sorts it descending | The host's order |
| `actions` | The list's options to offer as buttons on each row, by value; `[]` for none | All of the legend's |
| `default` | The option a click on a row, or Enter on it, runs | None |
| `list` | `"all"` or `"page"` ([above](#the-page-or-the-whole-list)) | `"all"` |
| `maxPages` | Stop reading after this many pages | 100 |
| `empty` | What to say when no rows match | "No rows" |

Users search by typing words that can be anywhere in the row; **Refresh** reads the list
again. Up and Down move between rows, Home and End go to the first and last, and Enter runs
the default option. **Export** stays in the key bar and exports the host's list.

## Totals

Tiles with totals of a list's columns, such as "16 jobs", "3 waiting for a reply" or
"$18,240.00 total".

```json
{ "op": "component", "name": "totals", "at": { "row": 18, "col": 2 }, "width": 60, "height": 3,
  "options": { "list": "all", "totals": [
    { "of": "count", "label": "orders" },
    { "of": "count", "where": { "Status": "HELD" }, "label": "held" },
    { "of": "sum", "column": "Amount", "currency": "USD", "label": "total" } ] } }
```

| Option | What it does | Default |
| --- | --- | --- |
| `totals` | What to show, in order (below) | `["count"]` |
| `list` | `"page"` totals the page showing; `"all"` the whole list | `"page"` |
| `title` | A caption above the tiles | None |

Each total is a string, `"count"`, `"sum:Amount"`, `"average:Amount"`, `"min:Price"` or
`"max:Ship date"`, or an object:

| Key | What it does |
| --- | --- |
| `of` | `count`, `sum`, `average`, `min` or `max` |
| `column` | The column (not needed for `count`) |
| `label` | The text under the number; default "rows", "total Amount" and so on |
| `decimals` | Decimal places; default the most the column shows (at least 1 for an average) |
| `currency` | A currency code such as `USD`, to show the amount as money |
| `where` | Count only rows whose columns have these values (ignoring case), e.g. `{ "Status": "HELD" }` |

Numbers are read as the host shows them: `1,234.50`, `12.50-` and `(12.00)` (negatives),
`$1,200`, `45%`. Cells that aren't numbers are left out of sums and averages. `min` and `max`
of a date column give the earliest and latest date. With `"list": "page"`, the tile says
"This page only" when the list has more pages.

## Chart

A list's columns as a chart: bars, stacked bars, lines, a pie or donut, or a sparkline.

```json
{ "op": "component", "name": "bar-chart", "at": { "row": 4, "col": 2 }, "width": 40, "height": 8,
  "options": { "type": "stacked", "column": ["Open", "Shipped"], "label": "Month", "title": "Orders" } }
```

| Option | What it does | Default |
| --- | --- | --- |
| `column` | The column to chart; for bars, stacked bars and lines, a list charts several | Required |
| `label` | The column naming each bar, point or slice | The first column |
| `type` | `bar`, `stacked`, `line`, `pie`, `donut` or `sparkline` | `bar` |
| `title` | A caption above the chart | None |
| `list` | `"page"` charts the page showing; `"all"` the whole list | `"page"` |

Hovering a bar, point or slice shows its values. **Table** switches to the numbers as a
table (screen readers always get the table). Two or more columns, and every pie, get a legend.
Bars below zero go down from the zero line. A pie or donut shows up to seven slices and puts
the rest together as "Other"; it, and stacked bars, leave out values below zero. A sparkline
is just the line, for a box a row or two high.

The colors follow the theme and are checked for color-blind readers, in light and dark
mode; a theme can set its own with `--chart-1` to `--chart-8`. (In earlier versions this was
the bar chart; its options still work and it still draws bars by default.)

## Board

A list as a board: its rows as cards, in a column (a lane) per value of a status column.

```json
{ "op": "component", "name": "board", "at": { "row": 3, "col": 2 }, "width": 79, "height": 17,
  "options": { "column": "Status", "lanes": ["Active", "On hold", "Inactive"],
               "title": "Name", "subtitle": "Company", "fields": ["City"], "default": "5" } }
```

| Option | What it does | Default |
| --- | --- | --- |
| `column` | The column to group by | Required |
| `lanes` | The lanes in order: values, or `{ "value": "HLD", "label": "Held" }`. Rows with another value go in a last "Other" lane | A lane per value, in the order they appear |
| `title`, `subtitle`, `fields` | What each card shows, as for [cards](#cards) | The first column; none; the others |
| `actions`, `default` | The options offered as buttons, and the one a click on a card runs | All of the legend's; none |
| `width` | The narrowest a lane gets, in pixels | 220 |
| `list`, `maxPages` | [Above](#the-page-or-the-whole-list) | `"all"`, 100 |

Cards keep a style rule's role (an "On hold" row styled as a warning gets a warning edge).
Arrow keys move between cards: Left and Right to the next lane, Up and Down within one. The
board shows the rows; it doesn't move them between lanes, which needs the host to change the
status.

## Calendar

A list's rows on a month or week calendar, by a date column.

```json
{ "op": "component", "name": "calendar", "at": { "row": 3, "col": 2 }, "width": 79, "height": 18,
  "options": { "date": "Ship date", "format": "MM/DD/YY", "title": "Customer", "default": "5" } }
```

| Option | What it does | Default |
| --- | --- | --- |
| `date` | The column with each row's date | Required |
| `format` | How the host writes the date: `MM/DD/YY`, `YYYY-MM-DD`, `CYYMMDD`, `YYMMDD`, `DD.MM.YYYY`… (Y year, M month, D day, C IBM's century digit, 0 for 19xx and 1 for 20xx; other characters must match) | ISO (`2026-11-05`), `MM/DD/YYYY` or `MM/DD/YY` |
| `title` | The column naming each entry | The first other column |
| `view` | `month` or `week` | `month` |
| `weekStart` | `0` for Sunday, `1` for Monday | 0 |
| `default` | The option a click on an entry runs | None |
| `list`, `maxPages` | [Above](#the-page-or-the-whole-list) | `"all"`, 100 |

It opens on today's month if anything falls in it, else the month of the earliest date.
Each day shows how many entries it has, and as many as fit. Clicking a day (or Enter on it)
lists its entries below the calendar; clicking one runs the default option on its row.
Arrow keys move a day (Up and Down a week), Page Up and Page Down a month (or a week).
Rows whose date can't be read are counted under the calendar, with a hint to set `format`;
all-zero dates (`0000000`, often "no date") are left out quietly.

## Tree

An indented list as a tree that opens and closes: a bill of materials, IFS folders, a menu
hierarchy.

```json
{ "op": "component", "name": "tree", "at": { "row": 4, "col": 2 }, "width": 79, "height": 17,
  "options": { "column": "Component", "level": "Lvl", "fields": ["Qty", "UOM"], "default": "5" } }
```

| Option | What it does | Default |
| --- | --- | --- |
| `column` | The column naming each item | The first column |
| `level` | A column with each row's level: `1`, `2`…, dots (`.2`, `..3`) or outline numbers (`1.2.3`) | How far `column`'s text is indented on the screen |
| `fields` | Other columns shown after each item's name | None |
| `open` | How many levels start open | All (a list over 300 rows: 1) |
| `default` | The option a click on an item's name, or Enter on it, runs | None |
| `list`, `maxPages` | [Above](#the-page-or-the-whole-list) | `"all"`, 100 |

Each row goes under the nearest row above it with a lower level. Keys are a tree's usual
ones: Up and Down move, Right opens an item (or goes to its first child), Left closes it (or
goes to its parent), Home and End, and `*` opens every item at that level. **Open all** and
**Close all** do the whole tree.

## Pin map

Every row of a customer or delivery list as a pin on one map.

```json
{ "op": "component", "name": "pin-map", "at": { "row": 3, "col": 42 }, "width": 39, "height": 17,
  "options": { "address": ["Street", "City", "State", "Zip"], "suffix": "USA", "label": "Name", "default": "5" } }
```

| Option | What it does | Default |
| --- | --- | --- |
| `address` | The columns that make up each row's address, in order; or a template, `"{City}, {State} {Zip}"` | Required |
| `suffix` | Text added to every address, such as a country | None |
| `label` | The column naming each pin | The first column |
| `default` | The option the pin's button runs | None |
| `maxPins` | Look up at most this many addresses | 50 |
| `geocoder` | A Nominatim-compatible search address | OpenStreetMap's |
| `tiles`, `attribution` | A map tile address with `{z}`, `{x}` and `{y}`, and the credit to show for it | OpenStreetMap's |
| `list`, `maxPages` | [Above](#the-page-or-the-whole-list) | `"all"`, 100 |

**Addresses leave your site**: each goes to the geocoder, and the map's tiles come from the
tile server. OpenStreetMap asks for no more than one lookup a second, so a long list fills
in over a few seconds; each address is looked up once per browser session. For a busy site,
run your own geocoder and tile server (or use a provider's) and set `geocoder` and `tiles`.
In the designer nothing is sent until the designer clicks **Show map**.

The map fits every pin it has found until the user moves it: drag to move, **+** and **−**
to zoom. Each pin is a button (Tab reaches them in list order) that shows the row's name,
its address and the default option's button.

## Cards

A list as cards, one per row, with the list's options as buttons. See
[Card view component](../README.md#card-view-component) for its options and use.

## Spool file

A spooled file (DSPSPLF, or option 5 on WRKSPLF; SDSF or ISPF BROWSE on a 3270) as one
document to scroll, search and download, instead of a screen at a time.

```json
{ "op": "component", "name": "spool", "at": { "row": 5, "col": 2 }, "width": 79, "height": 17, "options": {} }
```

| Option | What it does | Default |
| --- | --- | --- |
| `from`, `to` | The screen rows the report's text is on | From the row after DSPSPLF's column ruler (`*...+....1`) to the row before More.../Bottom |
| `title` | The caption, and the downloaded file's name | The spooled file's name from the screen |
| `read` | `auto` reads every page when the screen shows; `button` waits for **Read whole file** | `auto` |
| `maxPages` | Stop after this many pages | 300 |
| `wrap` | `true` wraps long lines instead of scrolling sideways | `false` |

Place it over the report's text; its background covers the screen there. It reads every
page as Export reads a list (to the top, down to "Bottom" or "BOTTOM OF DATA", and back).
For a 3270, or any screen without DSPSPLF's ruler, set `from` and `to`.

**Search** finds text anywhere in the file: Enter or ↓ goes to the next match, Shift+Enter or
↑ to the one before. **Download** saves it as a text file; **Read again** reads it afresh.
The text is as wide as the screen shows it, so a 132-column report needs a 27 × 132 session
(or the host's shift keys, F19 and F20, then **Read again**).

## Barcode scanner

A field with a camera button that types what the camera reads, as if the user typed it:
for warehouse and shipping screens on phones and tablets.

```json
{ "op": "component", "name": "scanner", "field": "6:22", "at": { "row": 6, "col": 22 }, "width": 20, "height": 1,
  "options": { "enter": true, "formats": ["code_128", "ean_13", "qr_code"] } }
```

In the designer, select the field and choose **Show as: Component**, then pick the scanner.

| Option | What it does | Default |
| --- | --- | --- |
| `formats` | The barcodes to read: `aztec`, `code_128`, `code_39`, `code_93`, `codabar`, `data_matrix`, `ean_13`, `ean_8`, `itf`, `pdf417`, `qr_code`, `upc_a`, `upc_e` | Every kind the browser can read |
| `enter` | `true` presses Enter after a scan | `false` |
| `beep` | `false` turns off the beep (and the buzz on phones) | On |
| `camera` | `environment` (the back camera) or `user` (the front) | `environment` |

The field still takes typing, and a hand-held scanner that types. The camera button opens a
picture from the camera; holding a barcode in the frame types it in. Esc or **Cancel**
closes it. The picture stays in the browser.

Reading barcodes needs the browser's barcode detector: Chrome and Edge on Android, ChromeOS
and macOS have it, as does Samsung Internet; Firefox and Safari don't yet. The camera also
needs the site on HTTPS. Where either is missing, the button is off and its tooltip says why.

## Help panel

Help for a screen, written in Markdown, in a panel at the side. It opens from an ⓘ **Help**
button, or the F1 key, alongside or instead of the host's own help.

```json
{ "op": "component", "name": "help-panel", "at": { "row": 21, "col": 2 }, "width": 12, "height": 1,
  "options": { "title": "Order entry", "markdown": [
    "## Entering an order",
    "Type the **customer number**, then each item and quantity.",
    "- F4 lists customers",
    "- [Shipping rules](https://intranet.example.com/shipping)" ] } }
```

| Option | What it does | Default |
| --- | --- | --- |
| `markdown` | The help: a string, or a list of lines | Required |
| `title` | The panel's heading | "Help" |
| `key` | The key that opens it: `F1` to `F24`, or `""` for the button only | `F1` |
| `host` | `replace`: the key opens this instead of the host's help; `alongside`: the panel also has a **Host help** button | `replace` |
| `label` | The button's text | "Help" |

The Markdown can have headings (`#`, `##`, `###`), paragraphs, lists (`-` or `1.`),
`**bold**`, `*italic*`, `` `code` ``, code blocks between ```` ``` ```` lines, `>` quotes and
links. It's shown as text, never as HTML, so it can't run scripts; links go only to
`http(s)` and `mailto` addresses, and open in a new tab. Esc closes the panel.

## Embedded page

A page from another system in a frame, its address built from the screen: the product page
or the scanned document for the order showing.

```json
{ "op": "component", "name": "embed", "at": { "row": 8, "col": 42 }, "width": 39, "height": 12,
  "options": { "url": "https://docs.example.com/orders/{4:20}", "title": "Order documents", "caption": true } }
```

| Option | What it does | Default |
| --- | --- | --- |
| `url` | The page's address, with screen values in braces: `{4:20}` is the field (as typed) or text at row 4, column 20; `{4:20:10}` takes exactly 10 characters | Required |
| `title` | What the frame shows, for screen readers and the caption | "Embedded page" |
| `caption` | `true` shows the title above the frame | `false` |
| `link` | `false` hides **Open in a new tab** | Shown |
| `sandbox` | The frame's sandbox keywords | `allow-scripts allow-same-origin allow-popups allow-forms` |

Only `https://` pages are shown (and `http://` on the same machine). Values are trimmed and
URL-encoded. While a value is blank, the box says which one it's waiting for. The frame
reloads a moment after the address changes, so typing doesn't reload it on every key. In the
designer the page isn't loaded, so screen values aren't sent, until **Show page**.

The other site must allow being framed: if it sends `X-Frame-Options: DENY` (or a
`Content-Security-Policy` `frame-ancestors` without your Veneer site), the browser shows an
error in the frame, and **Open in a new tab** still works.

## Status timeline

A status as steps, such as Ordered → Picked → Shipped → Delivered, with the current one
highlighted.

```json
{ "op": "component", "name": "timeline", "at": { "row": 3, "col": 40 }, "width": 40, "height": 3,
  "options": { "at": "6:20:3",
    "steps": [{ "value": "ORD", "label": "Ordered" }, { "value": "PCK", "label": "Picked" },
              { "value": ["SHP", "INT"], "label": "Shipped" }, { "value": "DLV", "label": "Delivered" }],
    "stopped": [{ "value": "CAN", "label": "Cancelled", "after": "ORD" }] } }
```

| Option | What it does | Default |
| --- | --- | --- |
| `steps` | The steps in order: the host's values, or `{ "value", "label" }`; a step can match several values | Required |
| `at` | Where the status is: `"6:20"` is the field there (as typed) or the text up to a double space; `"6:20:3"` exactly 3 characters. Not needed when the timeline is on the status field itself (**Show as: Component**) | |
| `stopped` | Values that end it early, such as cancelled; `after` is the last step reached | None |
| `direction` | `across` or `down` | `across` |

Steps before the current one are ticked; a stop shows the steps reached and the stop in the
danger color. A status that matches nothing shows the steps with none current, and the
status beside them. Hide the status text if the timeline replaces it.

## Map

An address from the screen on a map (OpenStreetMap or Google Maps). See
[Map component](../README.md#map-component).

## Star rating

A one-digit field as stars to click: put it on the field (**Show as: Component**), with
`{ "max": 5 }`.

## Troubleshooting

**The box says "No list on this screen has the columns …".** A heading in the options isn't
on any list on the screen. Check the spelling against the screen (case doesn't matter), and
that Veneer found the list (it's drawn as a table when the component is removed).

**The component doesn't load.** The browser console says why. A component that needs
`lib/`, `cards.js` or `map.js` fails to load without them; copy them beside it and restart
Veneer.

**"Press Enter or clear your changes first."** A component reads the whole list only when
nothing typed on the screen is waiting to be sent. Press Enter, or clear what you typed;
the next screen reads the list again. (After two failed reads in a row, a component waits
until you leave the screen and come back, or click the whole-list table's **Refresh**.)

**Reading the list shows a progress dialog every time.** Short lists read without one; long
ones show it after a moment, as Export does. Use `"list": "page"`, or narrow the list on the
host first, if that's too slow. Each read is one round of page keys, so a list of 20 pages
sends about 40 keys.

**An option on a row says the list has changed.** The row isn't on its page any more
(another user added or deleted rows). The component reads the list again; try once more.

**Text from the screen shows through a component.** Hide the screen's text under the box
(select it in the designer and click **Hide**). Components draw over text, but not over the
gaps between their own parts.
