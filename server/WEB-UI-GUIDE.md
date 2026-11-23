# FoodWarden web UI guide

Use this guide when changing the dashboard. Read the [design research and audit](UX-RESEARCH.md) for examples and the reasons behind these decisions. Keep the source links and browser verification up to date as behavior changes.

## Screen ownership

| Screen | Primary task | Source |
| --- | --- | --- |
| My fridges | Compare food totals, upcoming expiry and sensor freshness, then open a fridge | [FridgeHub](src/main.tsx) |
| Food | Check current sensor values, see what expires soon, and add or take out food, and manage private favorites below inventory | [Metrics](src/Metrics.tsx), [Inventory](src/Inventory.tsx), [FridgeFavorites](src/FridgeFavorites.tsx) |
| Charts | Choose sensor metrics and one time window, inspect a reading, or open the readings table beside the chart | [Charts](src/Charts.tsx) |
| History | Find a past food change, door event, or sensor reading by date and type | [Activity](src/Activity.tsx), [history query](workers/lib/activity.ts) |
| Devices | Identify a device that needs attention. Show recent door events and link to the complete history | [Devices](src/Devices.tsx) |
| Me | Appearance and personal LINE notifications through the header account link | [MyAccount](src/MyAccount.tsx) |
| Settings | Fridge name, household members, shared LINE connection, and hardware setup | [Settings](src/Settings.tsx) |

## Layout and interaction

- Keep the first view focused on the current fridge, sensor freshness, and food actions. Let content grow vertically at narrow widths and large text sizes. Keep one page scrollbar and reserve room for the phone navigation and keyboard focus.
- Group related readings into one surface. Use a visible label and icon for each value. Use dividers and spacing for grouping. Keep red for fault, destructive, and expired states. Pair color with text.
- Prefer native `select`, `input`, `button`, `label`, `details`, and `table` for standard tasks. Use the shared font, field border, focus outline, and spacing. Preserve the browser's date and time pickers and checkbox states. Retain the existing dialog primitive for confirmations.
- Use links for navigation and buttons for actions. Name controls in Thai and English, give icon-only actions an accessible name, and keep focus visible on keyboard navigation. Use a visible label and field boundary for text entry and pickers. Use a clear verb and a familiar icon for quiet standalone buttons. Use stronger text contrast and a subtle surface tint on hover. Keep underlines for inline links where they distinguish links from prose.
- Give each selected sensor metric its own labeled plot, unit, and threshold. Align the time windows across plots and keep one shared reading selector and readings table. Keep missing readings as gaps. Show the selected value and time outside hover, and put the optional table below the plot. Load Recharts only on the Charts route.
- Readings show elapsed time and the exact Bangkok time. For date-only filters, query midnight to midnight in Asia/Bangkok, independent of the browser timezone. Keep source event and sensor timestamps distinct from the time a web view last refreshed.
- History reads 15 rows per request. The cursor combines the timestamp and row ID so tied timestamps remain pageable. Use the existing telemetry and door records. Inventory events start when the migration is applied and capture actual changes. Previous edits and removals cannot be reconstructed from the current inventory table.
- Use [dashboard-theme.css](src/dashboard-theme.css) for component layouts, [ui-theme.css](src/ui-theme.css) for tokens and themes, and [style.css](src/style.css) for shared base styles. Trace each selector to its JSX before adding another styling path.

## Choosing a control

| FoodWarden task | Control | Reason |
| --- | --- | --- |
| Invite a member or owner | Native radio group with role descriptions | The permission choices should be available for comparison before inviting. Member is the default. |
| Show temperature, VOC, or light | Native checkboxes | Every choice is independent. Users can add, remove, or clear metrics in place and see which are enabled. A link from a dashboard reading sets the initial metric. |
| Change the chart period | Native range input with four labeled stops | The periods are ordered and bounded. Show the exact active value and expose it to assistive technology. Keep the reading cursor separate. |
| Switch fridges, sensors, or food categories | Native select | One choice is active, the list can grow, and showing it all would push the main task down the page. |
| Set language, palette, layout, sort order, or history type | Native select | These are compact one-of-several choices. The active choice stays visible and the shared control keeps the form short. |
| Pick a date or notification time | Native date or time input | The browser owns the picker and chooses the visible format from its locale. The notification value is stored as HH:mm and uses Bangkok time. When the native picker falls back to text, the field shows the HH:mm hint and validates 24-hour input. |
| Expand hardware connections | Button with a title, chevron, and expanded state | Users can recognize the subject and disclosure affordance. A neutral icon identifies the connection and a divider groups the rows. |
| Copy a token or remove access | Quiet text button with an icon | A clear verb and icon identify the action. Keep keyboard focus, a full hit area, and confirmation for consequential actions. |

Visible options support recognition and comparison, especially for choices with different consequences. A select saves space when the full list has low value on screen. Use the data model to decide whether selection is exclusive or independent. [MDN radio group](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/radio), [MDN checkbox](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/checkbox), [MDN select](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/select), [MDN time input](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/time), [MDN range input](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/range).


## Compact navigation

- Keep the brand and header actions on one line. In viewports at or below 380 CSS pixels, the brand shows the fridge mark with its accessible name. Language and sign-out use labeled icon buttons. The account link uses a round avatar inside a transparent touch target.
- Show icon descriptions on pointer hover and keyboard focus. A tap opens an account, changes language, or signs out in one action. Give a back link such as All fridges visible destination text and an arrow because its meaning depends on the current page.
- Keep a light boundary around a fridge card when the whole card is the navigation target. Use the fridge name and chevron to show where it goes. Role and gateway freshness are information and use plain text. Keep field boundaries and strong actions visible.

## Reference index for contributors and agents

| When changing | Read |
| --- | --- |
| HTML elements, labels and controls | [MDN HTML](https://developer.mozilla.org/en-US/docs/Web/HTML), [label](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/label), [select](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/select), [checkbox](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/checkbox), [date](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/date), [time](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/time) |
| Semantic structure and keyboard behavior | [MDN accessibility](https://developer.mozilla.org/en-US/docs/Web/Accessibility), [details](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/details), [table](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/table), [Vercel Web Interface Guidelines](https://github.com/vercel-labs/web-interface-guidelines) |
| Layout, small screens and compatibility | [MDN CSS](https://developer.mozilla.org/en-US/docs/Web/CSS), [responsive design](https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/CSS_layout/Responsive_Design), [scroll-padding-bottom](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/scroll-padding-bottom), [MDN Baseline](https://developer.mozilla.org/en-US/docs/Glossary/Baseline/Compatibility) |
| JavaScript, dates, Fetch and browser APIs | [MDN JavaScript](https://developer.mozilla.org/en-US/docs/Web/JavaScript), [MDN Web APIs](https://developer.mozilla.org/en-US/docs/Web/API), [RelativeTimeFormat](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/RelativeTimeFormat), [DateTimeFormat](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat), [Fetch](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API) |
| SPA and library APIs | [React](https://react.dev/reference/react), [React Router](https://reactrouter.com/), [Vite](https://vite.dev/guide/), [SWR](https://swr.vercel.app/docs/getting-started), [Recharts](https://recharts.github.io/en-US/api/LineChart/) |
| D1 migrations, page queries and local snapshots | [D1 prepared statements](https://developers.cloudflare.com/d1/worker-api/prepared-statements/), [SQLite triggers](https://www.sqlite.org/lang_createtrigger.html), [Wrangler D1 commands](https://developers.cloudflare.com/d1/wrangler-commands/), [Cloudflare import and export](https://developers.cloudflare.com/d1/best-practices/import-export-data/) |

Verify documentation against [package versions](package.json) and MDN's compatibility table for the specific element or CSS property. Use the links above as the entry points to the full references.


### Offline MDN source

The local checkout is `.local-docs/mdn-content/`. The initial snapshot has 14,760 English index pages at commit `ea7722e995404f47bfaa0d7d0c011472d85aa972`. It is ignored by the FoodWarden Git repository. Use targeted searches to select the actual reference for the task. MDN's document source and license stay in the upstream checkout.

```sh
rg --files --no-ignore .local-docs/mdn-content/files/en-us | rg "elements[/\\]input[/\\]time[/\\]index.md|relativetimeformat|responsive_design"
```

For a machine without a local checkout, use the reference URLs above or clone the official repository with `git clone --depth 1 https://github.com/mdn/content.git .local-docs/mdn-content`. If the raw source uses compatibility macros, open the rendered MDN page for the browser matrix. [MDN content repository](https://github.com/mdn/content) and [MDN licensing](https://developer.mozilla.org/en-US/docs/MDN/Writing_guidelines/Attrib_copyright_license).

## Verification

- At phone and desktop widths, check Thai and English, long names, narrow date/time fields, and the last control above the fixed navigation. Tab through the page and operate the select, checkbox, slider, and buttons using the keyboard.
- On the dashboard, confirm the latest reading, its age, and food actions are visible early. Test missing, stale, and high sensor values. On Charts, change the metric and range, scrub the time, then expand the readings table. On History, switch types, choose a date, and page through tied timestamps.
- Run the source, UI and Worker test suites, TypeScript checks, lint and the production build. For visual smoke tests with a D1 export, first verify the path is ignored. Use a new local persistence directory and keep the original SQL export separate. D1 exports include private app data. Keep snapshots, browser credentials and exports out of commits and public previews.
