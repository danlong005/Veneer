# Widgets: field widgets, output text, labels and images

A screen definition can change how parts of a green screen look and are used,
without changing the host program. This guide covers the three kinds of widget,
how to add each one in the designer or in a definition file, its settings, and
what users see and do with it.

| Kind | Changes | Change in a definition | In the designer |
| --- | --- | --- | --- |
| [Field widgets](#field-widgets) | How an **input field** is edited: a dropdown, a switch, a time picker… | `widget` | Select the field ▸ **Show as** |
| [Output text](#output-text) | How **text the host shows** reads: a status badge, a formatted number, a link, a barcode… | `display` | Select the text ▸ **Show as**, or select a list ▸ **Column** |
| [Labels and images](#labels-and-images) | **New things** on the page: a heading, a note with help, a picture | `label`, `image` | Page tab ▸ **Labels and images**, or click an empty spot |

What the host sees never changes. A field widget converts values to and from the
host's format, so the host gets the same fields and values a terminal would send.
Output text is only read. Labels and images belong to the page, not the host.

**Contents:** [Try them in the demo](#try-them-in-the-demo) · [Adding a widget](#adding-a-widget) ·
Field widgets: [Dropdown](#dropdown) · [Radio buttons](#radio-buttons) · [Checkbox](#checkbox) ·
[Switch](#switch) · [Date picker](#date-picker) · [Time picker](#time-picker) · [Spinner](#spinner) ·
[Text area](#text-area) · [Masked input](#masked-input) · [Lookup](#lookup) ·
Output text: [Status badge](#status-badge) · [Number](#number) · [Date](#date) · [Yes or no](#yes-or-no) ·
[Link](#link) · [Progress bar](#progress-bar) · [Barcode or QR code](#barcode-or-qr-code) ·
[Label](#label) · [Image](#image) · [Troubleshooting](#troubleshooting)

## Try them in the demo

`npm run demo` (after `npm run build`) shows every widget on a screen, each from a
definition file you can copy: sign on with any name, then type the menu option. In the
designer (**Design**), select a widget to see its settings. The files are in
[`packages/server/dev/screens/`](https://github.com/danlong005/Veneer/blob/main/packages/server/dev/screens).

| Widgets | Menu option | Definition |
| --- | --- | --- |
| Dropdown, date picker, checkbox | 2 | [`demo-order-entry.json`](https://github.com/danlong005/Veneer/blob/main/packages/server/dev/screens/demo-order-entry.json) |
| Radio buttons, spinners, text area | 7 | [`demo-shipping-notes.json`](https://github.com/danlong005/Veneer/blob/main/packages/server/dev/screens/demo-shipping-notes.json) |
| Time picker, masked input, lookup (with F4), switch, a note with help | 16 | [`demo-delivery-options.json`](https://github.com/danlong005/Veneer/blob/main/packages/server/dev/screens/demo-delivery-options.json) |
| Status badge, number, progress bar on a list's columns | 11 | [`demo-orders.json`](https://github.com/danlong005/Veneer/blob/main/packages/server/dev/screens/demo-orders.json) |
| Status badge, date, number, yes or no, email, phone and web links, progress bar, Code 128 barcode and QR code, a heading, a note with help, an image | 15 | [`demo-order-status.json`](https://github.com/danlong005/Veneer/blob/main/packages/server/dev/screens/demo-order-status.json) |

On option 15, type another order number (104571 to 104584) to see each display change;
orders that have shipped have a tracking barcode.

## Adding a widget

**In the designer** (see [Screen customizations and the designer](../README.md#screen-customizations-and-the-designer)
for turning it on):

1. Open the screen in Veneer and click **Design**. If the screen has no customization
   yet, the panel starts a new one for it.
2. Click what you want to change: an input field, some text, a list, or an empty spot.
   The **Selected** tab shows its settings.
3. Pick a widget from **Show as** (for a list: pick the **Column**, then **Show its cells
   as**), or add a label or image. The screen shows the result as you change settings.
4. Click **Preview** to see the page as users will, and try the widget there.
5. Click **Save**. Everyone's page picks up the change at once.

The **Page** tab's **Changes** list shows every change in the customization, such as
"Show Status as a status badge". Click one to select what it changes, or × to remove it.

**In a definition file:** add the change to the definition's `changes` in
`screens/<id>.json` (or `VENEER_SCREENS_DIR`). Positions are 1-based rows and columns as
the host puts things; a field is named by its id, `"row:col"` of its first character.
The designer shows both for whatever is selected. Veneer checks every definition when it
loads it and when the designer saves it; an error names the change and the setting, such
as `changes[3].widget.mask: needs at least one 9 (a digit), A (a letter) or X (any character)`.

```json
{
  "id": "order-entry",
  "name": "Order entry",
  "match": { "screenIds": ["04e026716dd801"], "text": [] },
  "changes": [
    { "op": "widget", "field": "11:22", "widget": { "type": "toggle", "on": "Y", "off": "N" } },
    { "op": "display", "column": "Status", "display": { "type": "badge", "values": [{ "value": "MSGW", "label": "Waiting for reply", "role": "danger" }] } },
    { "op": "label", "at": { "row": 4, "col": 4 }, "text": "Order details", "style": "heading" }
  ]
}
```

**Colors** (`role`) are the same everywhere: `normal`, `emphasis` (bold), `muted`,
`danger` (error red), `warning`, `accent` (the theme's accent color) and `accent2`
(highlight). Themes set what they look like.

## Field widgets

A `widget` change shows one input field differently:

```json
{ "op": "widget", "field": "7:22", "widget": { "type": "select", "options": [ … ] } }
```

Widgets on a list's option fields apply to every row. Field rules still hold under every
widget: a monocase (upper-case) field converts as you type, a full field moves on to the
next one (or presses Enter, for auto-enter fields), and mandatory fields are checked before
Enter. Keys the host gives meaning to, such as F4, still go to the host.

| Show as | `type` | For |
| --- | --- | --- |
| [Dropdown](#dropdown) | `select` | A field with a short list of allowed values |
| [Radio buttons](#radio-buttons) | `radio` | A few choices, all visible at once |
| [Checkbox](#checkbox) | `checkbox` | A one-character yes/no field |
| [Switch](#switch) | `toggle` | A yes/no field for a setting that is on or off |
| [Date picker](#date-picker) | `date` | A date in the host's format |
| [Time picker](#time-picker) | `time` | A time in the host's format |
| [Spinner](#spinner) | `spinner` | A number stepped up and down |
| [Text area](#text-area) | `textarea` | Several fields, such as comment lines, edited as one box |
| [Masked input](#masked-input) | `mask` | A fixed pattern such as a phone or account number |
| [Lookup](#lookup) | `lookup` | Suggestions while typing, and a button for the host's F4 prompt |

### Dropdown

A list of choices; the user picks one instead of typing a code.

```json
{ "type": "select", "options": [{ "value": "TX", "label": "Texas" }, { "value": "IL", "label": "Illinois" }] }
```

| Setting | Meaning |
| --- | --- |
| `options` | The choices, up to 200: `value` is sent to the host, `label` is shown |

- **Designer:** **Show as: Dropdown**, then type the choices one per line as `value=Label`
  (`TX=Texas`). A line without `=` is both.
- **Users:** pick from the list. A value the host sent that matches no choice shows
  nothing chosen and is kept as it is until the user picks one.

### Radio buttons

The choices side by side (or one under another), all visible at once.

```json
{ "type": "radio", "options": [{ "value": "A", "label": "Air" }, { "value": "O", "label": "Ocean" }], "layout": "row", "allowClear": true }
```

| Setting | Meaning |
| --- | --- |
| `options` | As for a dropdown |
| `layout` | `row` (side by side, the default) or `column` (a row each) |
| `allowClear` | `true` adds a **None** choice that clears the field (sends blanks) |

- **Designer:** **Show as: Radio buttons**, the choices as for a dropdown, a **Layout**, and
  **Add a "None" choice**. In a `column` layout each choice takes a row, so leave room
  below the field or move what is there.
- **Users:** click a choice; arrow keys move between them and Tab goes on to the next field.

### Checkbox

A box ticked for one value and clear for another.

```json
{ "type": "checkbox", "on": "Y", "off": "N" }
```

| Setting | Meaning |
| --- | --- |
| `on` | The value sent when ticked; the box is ticked when the field holds it |
| `off` | The value sent when cleared (can be `""` for blanks) |

### Switch

The same as a checkbox, drawn as an on/off switch. Use it for settings ("Print
confirmation", "Active") rather than answers to a question.

```json
{ "type": "toggle", "on": "Y", "off": "N" }
```

| Setting | Meaning |
| --- | --- |
| `on` | The value sent when switched on; the switch is on when the field holds it (ignoring blanks around it) |
| `off` | The value sent when switched off |

- **Designer:** **Show as: Switch**, then **On value** and **Off value** (Y and N to start).
- **Users:** click the switch, or Tab to it and press Space. Screen readers announce it as
  a switch, on or off.

### Date picker

The browser's date picker, in the user's own date format, for a field holding a date in
the host's format.

```json
{ "type": "date", "format": "YYYYMMDD" }
```

| Setting | Meaning |
| --- | --- |
| `format` | The host's format: `YYYYMMDD`, `MMDDYYYY`, `MMDDYY`, `DDMMYYYY`, `DDMMYY`, `YYMMDD`, `MM/DD/YYYY`, `MM/DD/YY`, `DD/MM/YYYY` or `YYYY-MM-DD` |

Two-digit years 40-99 are read as 19xx and 00-39 as 20xx, as IBM i does. A value that is
not a date in the format (such as zeros) shows an empty picker.

### Time picker

The browser's time picker, for a field holding a time in the host's format. It shows
times the user's way (2:30 PM in the US, 14:30 in most places) and sends the host its own.

```json
{ "type": "time", "format": "HHMMSS" }
```

| Setting | Meaning |
| --- | --- |
| `format` | The host's format: `HHMMSS`, `HHMM`, `HH:MM:SS`, `HH:MM`, `HH.MM.SS` (IBM i `*HMS` with a period) or `HH.MM`. Hours are 00-23 |

- **Designer:** **Show as: Time picker**. Veneer guesses the format from the field's
  length (4 is `HHMM`, 5 `HH:MM`, 6 `HHMMSS`, 8 `HH:MM:SS`); change it if the host uses
  another. A format whose length differs from the field's is flagged.
- **Users:** type the time or use the picker. Formats with seconds offer seconds; without
  them, seconds the user picks are dropped. A time picked without seconds is sent with 00.
  A value that is not a valid time (such as blanks) shows an empty picker.

### Spinner

A number with up and down buttons.

```json
{ "type": "spinner", "min": 0, "max": 999, "step": 1 }
```

| Setting | Meaning |
| --- | --- |
| `min`, `max` | The lowest and highest values; either may be left out |
| `step` | How much one click changes it; default 1 |

The Up and Down arrow keys step it too. It follows the field's rules, so what it sends is
what typing the number would send. Signed numeric fields have their decimals implied, so
count in the units typed: on a field holding 12.50 as `1250`, a `step` of 100 is one whole.
The designer offers the spinner for numeric fields only.

### Text area

Several input fields, such as comment lines 1 to 4, edited as one box.

```json
{ "type": "textarea", "fields": ["14:10", "15:10", "16:10", "17:10"] }
```

| Setting | Meaning |
| --- | --- |
| `fields` | The fields, one per line (up to 27), starting with the widget's own |

See the [README's text area notes](../README.md#field-widgets) for how text wraps between
the fields and how the designer finds them.

### Masked input

A box that types into a fixed pattern, such as `999-99-9999` or `(999) 999-9999`. The user
types only the characters; the separators appear by themselves.

```json
{ "type": "mask", "mask": "(999) 999-9999" }
```

| Setting | Meaning |
| --- | --- |
| `mask` | The pattern: `9` takes a digit, `A` a letter, `X` any character; anything else is a separator |
| `literals` | `true` when the host field holds the separators too. Without it, only the typed characters are sent |

Which to use depends on the host field. A 10-character phone field holding `5551234567`
takes `(999) 999-9999` without `literals`; a 14-character field holding `(555) 123-4567`
takes the same mask with `"literals": true`.

- **Designer:** **Show as: Masked input**. It starts as one `9` per character of the
  field: type the pattern you want, and tick **The host field holds the separators too**
  if it does. The designer warns when the mask doesn't fit the field's length.
- **Users:** type the digits or letters. A character a slot won't take (a letter where a
  digit goes) is ignored, and so are separators typed by hand. The box shows the pattern as
  a placeholder (`(___) ___-____`) while empty. When every slot is filled, the cursor moves
  to the next field, as a full field does. Pasting `555.123.4567` gives `(555) 123-4567`.
- **Values the host sends** show with the separators put in, with or without `literals`.

### Lookup

A text box that suggests values as the user types, with a button that opens the host's
own prompt for the field.

```json
{ "type": "lookup", "options": [{ "value": "TX", "label": "Texas" }], "prompt": { "aid": "F4" } }
```

| Setting | Meaning |
| --- | --- |
| `options` | Suggestions, up to 200: `value` is typed into the field, `label` describes it. Optional |
| `prompt` | A key the look-up button presses with the cursor in this field, such as `{ "aid": "F4" }`. Optional |

It needs at least one of the two. Unlike a dropdown, any value can still be typed.

- **Designer:** **Show as: Lookup**. It starts with an F4 button: on most IBM i screens F4
  in a field opens the host's prompt or list of values for it. Pick another key or **No
  button** under **Look-up button presses**, and type suggestions one per line as
  `value=Label`. The key must exist on the host type (a 3270 has no Help key; a 5250 has
  no PA1).
- **Users:** type; suggestions that match appear under the box, from the browser's own
  list (each with its label), and Down arrow opens it. Click the magnifier button to send the key, as pressing it in the
  field would: what was typed on the screen goes with it, and the host shows its prompt.

## Output text

A `display` change shows text the host put on the screen differently. Point it at the
text by position, or at a list column by heading, so every row's cell shows the same way:

```json
{ "op": "display", "at": { "row": 4, "col": 20 }, "display": { "type": "date", "format": "YYYYMMDD" } }
{ "op": "display", "column": "Status", "display": { "type": "badge", "values": [ … ] } }
```

| Setting | Meaning |
| --- | --- |
| `at` | The text at this position (where the host put it, even if a `move` change draws it elsewhere) |
| `column` | A list column, by its heading, ignoring case. Cells with input fields (such as the option column) keep their field |
| `display` | How it shows (below) |

Exactly one of `at` and `column`. In the designer, select the text and pick **Show as**, or
select the list, pick the **Column** and **Show its cells as**. Columns already shown
differently are marked ●.

Text that a display can't read (a "number" that isn't one, a date in another format) shows
as the host sent it, so nothing is lost. What users copy from the screen is what they see.

| Show as | `type` | For |
| --- | --- | --- |
| [Status badge](#status-badge) | `badge` | Codes such as MSGW, RUN, HLD as colored, readable pills |
| [Number](#number) | `number` | Amounts with thousands separators, implied decimals, a currency |
| [Date](#date) | `date` | Host dates the user's way |
| [Yes or no](#yes-or-no) | `yesno` | Y/N flags as ✓ Yes / ✗ No |
| [Link](#link) | `link` | Email addresses, phone numbers, web addresses |
| [Progress bar](#progress-bar) | `progress` | A percentage or quantity against a maximum |
| [Barcode or QR code](#barcode-or-qr-code) | `barcode` | An item, order or tracking number as a scannable code |

### Status badge

Turns codes into colored pills with words people understand: `MSGW` becomes a red
"Waiting for reply".

```json
{ "type": "badge", "values": [
  { "value": "MSGW", "label": "Waiting for reply", "role": "danger" },
  { "value": "RUN", "label": "Running", "role": "accent" },
  { "value": "HLD", "role": "warning" }
], "otherwise": "muted" }
```

| Setting | Meaning |
| --- | --- |
| `values` | The codes to recognise (ignoring case and blanks around them), each with a `label` to show (left out: the code itself) and a color (`role`) |
| `otherwise` | The color for other codes, shown as plain text. Left out: as the host sent it |

- **Designer:** **Show as: Status badge**. It starts with the selected text as its first
  value. **Add value** adds a row: the code, what it shows as, and its color. **Other
  values** sets how unrecognised codes look.
- **Users:** see the label; hovering a badge shows the host's own code.

A badge changes what the text says; to only color rows or cells by a code, use a `style`
change ([README](../README.md#screen-customizations-and-the-designer)). The two work together.

### Number

A number with the user's thousands and decimal separators (1,234.50 in the US, 1.234,50
in Germany), read the way the host shows them: `1,234.50`, `12.50-`, `12.50 CR`.

```json
{ "type": "number", "implied": 2, "decimals": 2, "currency": "USD" }
```

| Setting | Meaning |
| --- | --- |
| `implied` | Decimals the host leaves out (0-9): with 2, `1250` shows 12.50. Only used when the text has no decimal point |
| `decimals` | How many decimals to show (0-9). Left out: as many as the text has (or `implied`) |
| `currency` | An ISO currency code such as `USD`, `EUR` or `GBP`, to show its symbol |

The **Designer** shows what the selected text, or the column's first value, becomes.
Numbers line up on the right, as on the host.

### Date

A date in the host's format shown the user's way.

```json
{ "type": "date", "format": "YYYYMMDD", "style": "medium" }
```

| Setting | Meaning |
| --- | --- |
| `format` | The host's format, as for the [date picker](#date-picker) |
| `style` | `short` (3/4/26), `medium` (Mar 4, 2026; the default) or `long` (March 4, 2026), in the user's language |

A shown date can be wider than the host's text (`20260304` is 8 characters, "March 4,
2026" 13) and run into what is to its right. The designer says when it does: pick a
shorter style or move what is there. Hovering a date shows the host's text.

### Yes or no

A flag shown as ✓ Yes or ✗ No.

```json
{ "type": "yesno", "yes": "Y", "no": "N" }
```

| Setting | Meaning |
| --- | --- |
| `yes` | The value meaning yes (not blank) |
| `no` | The value meaning no; `""` makes blanks mean no |

Values are matched ignoring case; any other value shows as it is.

### Link

Makes the text a link: an email address opens the user's mail, a phone number dials (on
phones, and desktops with a calling app), a web address opens in a new tab.

```json
{ "type": "link", "to": "email" }
{ "type": "link", "to": "phone" }
{ "type": "link", "to": "url", "url": "https://crm.example.com/customers/{value}" }
```

| Setting | Meaning |
| --- | --- |
| `to` | `email`, `phone` or `url` |
| `url` | For `url` only: the address to open. `{value}` is the text itself, `{row:col}` other text on the screen (as in [link buttons](../README.md#screen-customizations-and-the-designer)), all URL-encoded. Left out: the text must itself be an `http(s)` address |

Text that isn't an email address or a phone number (digits, spaces, `()-.` and a leading
`+`) stays plain. Only `http://` and `https://` addresses with a fixed host name are
allowed. On a list column, `{value}` is each row's own cell: a **User** column with
`https://directory.example.com/{value}` links each user to their page.

### Progress bar

A bar filled to the number's share of a maximum, with the number on it.

```json
{ "type": "progress", "max": 100 }
```

| Setting | Meaning |
| --- | --- |
| `max` | The number that fills the bar, such as 100 for a percentage |

Numbers over `max` show a full bar, below 0 an empty one. In a list the bar fits the
column; elsewhere it is at least 8 characters wide. Screen readers read the value.

### Barcode or QR code

The text drawn as a QR code or a Code 128 barcode, for scanning on a warehouse floor or
at a shipping desk. Veneer draws them itself; nothing is sent elsewhere.

```json
{ "type": "barcode", "format": "qr", "height": 4 }
```

| Setting | Meaning |
| --- | --- |
| `format` | `qr` or `code128` |
| `height` | Rows it covers (1-20), from the text's row down |

- **QR codes** hold any text (in UTF-8), with medium error correction, and are as small as
  the text allows. Four rows are enough for a short code to scan from a screen.
- **Code 128** holds letters, digits and the usual symbols (printable ASCII). Long runs of
  digits are packed, so numeric codes stay short. With 2 rows or more the text is printed
  under the bars. Text it can't hold shows as text.

The code covers the rows below the text: leave them empty, or move what is there. Blank
text draws nothing.

## Labels and images

### Label

New text on the page: a heading over a group of fields, a note, an instruction, with an
optional ⓘ that shows help.

```json
{ "op": "label", "at": { "row": 4, "col": 4 }, "text": "Shipping", "style": "heading", "role": "accent", "help": "Where and how the order is sent." }
```

| Setting | Meaning |
| --- | --- |
| `at` | Where the text starts |
| `text` | The text, up to 132 characters |
| `style` | `text` (the default), `heading`, `subheading` or `note` (small and muted) |
| `role` | Its color (see [Colors](#adding-a-widget)); default `normal` |
| `help` | Up to 500 characters, shown from an ⓘ after the text |

- **Designer:** on the **Page** tab, **Labels and images ▸ Add label** puts one on the first
  empty row; or click an empty spot on the screen and **Add label here**. Then set its text,
  style, color and help on the **Selected** tab. Drag it, use the arrow keys, or type a row
  and column to move it.
- **Users:** see the text. The help shows while the pointer is over the ⓘ, or when Tab
  reaches it, and screen readers read it as the ⓘ's description.

To reword text the host shows, use a `text` change instead (select the text ▸ **Text**).

### Image

A picture in a box on the page: the company logo, a product photo, a diagram.

```json
{ "op": "image", "at": { "row": 2, "col": 60 }, "src": "banner.png", "alt": "Acme Supply", "width": 18, "height": 4 }
{ "op": "image", "at": { "row": 6, "col": 56 }, "src": "/products/{6:12}.jpg", "alt": "Product photo", "width": 20, "height": 8, "fit": "cover" }
```

| Setting | Meaning |
| --- | --- |
| `at`, `width`, `height` | The box: its top-left cell and its size in columns and rows |
| `src` | Where the picture comes from: see below |
| `alt` | What it shows, for people who can't see it, and shown if it can't be loaded. Leave it empty for a decoration |
| `fit` | `contain` (the whole picture, the default) or `cover` (fill the box, cropping) |

The picture can be:

- **An image of the theme in use**, by its file name: `banner.png`. Add images to a theme
  on the designer's **Themes** tab (**Artwork**; PNG, SVG, JPEG, WebP or GIF up to 1 MB), so
  they are versioned in git with the theme. If another theme is put in use, it needs an
  image with the same name.
- **A web address**: `https://cdn.example.com/items/{6:12}.jpg`.
- **A path on the Veneer site**: `/products/{6:12}.jpg`, for images a proxy in front of
  Veneer serves.

In an address, `{row:col}` takes the field or text there, as in link buttons, so an item
number on the screen shows that item's photo. Each value is URL-encoded, so it can't add
path segments.

- **Designer:** **Labels and images ▸ Add image**, or **Add image here** on an empty spot.
  Pick a **Picture** from the theme's images, or **A web address or site path** and type
  it; the panel shows the address it loads for this screen. Drag the image to move it and
  its corner handle to resize it.
- **Users:** see the picture. If it can't be loaded, the description shows in its place.

## Troubleshooting

- **A widget doesn't appear:** check the **Page** tab says the customization **matches this
  screen**, and that the change is in the **Changes** list. A `display` at a position
  needs output text there (not an input field, not a label); a `column` needs a heading
  that matches.
- **The definition won't save or load:** the message names the change and setting
  (`changes[2].display.max: must be more than 0`). The server log says the same for files
  edited by hand.
- **The host rejects a value:** check the widget sends what the field expects: the date
  or time `format`, a mask's `literals`, the checkbox or switch `on` and `off` values.
  **Classic view** shows the screen as a terminal would, with the values as typed.
- **Something overlaps:** radio buttons in a column, barcodes and long dates take more room
  than the host's text. Move what is next to them (drag it, or a `move` change).
