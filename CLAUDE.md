# CLAUDE.md — Project Notes for Future Claude Sessions

This file briefs you on the Caps Vault project. Read it before doing any work
on the site so you don't have to re-derive the architecture from the code.

## What this is

**capsgameused.com** (also reachable at caps-vault.pages.dev) is a personal
collection website for Jay's Washington Capitals game-worn jerseys and
memorabilia. The site is browseable by visitors and editable in place by Jay
(the admin) — text, photos, covers, featured pieces, all live edits.

## Tech stack

- **Single-page app**: One large `index.html` (~1MB+) at the repo root.
  Everything — markup, CSS, and JS — lives in this one file. Some images are
  base64-embedded; most are served as files from `/images/` or via the
  SmugMug-backed Pages function.
- **Hosting**: Cloudflare Pages (free tier), Git-deployed from this repo.
  Pushes to `main` auto-trigger a deploy. Production domain is
  `capsgameused.com`; preview/legit domain is `caps-vault.pages.dev`. Note:
  `capsvault.pages.dev` (no hyphen) is somebody else's project — don't test
  against that URL.
- **Backend**: A single Cloudflare Pages Function at
  `functions/api/smugmug.js` handles all server logic. It proxies SmugMug's
  OAuth-signed v2 API for image fetching, and reads/writes the KV store for
  all admin-editable data.
- **Data**: One Cloudflare KV namespace bound as `CAPS_VAULT_KV` holds
  every persistent piece of admin state (covers, featured pieces, edited
  text, gallery order, photo metadata, etc.). See KV schema below.
- **Photo source**: Jay uploads to SmugMug separately. In the admin UI he
  pastes a SmugMug album URL into a gallery; the function fetches the
  image list and the album URL is saved to KV so all future visitors see
  the photos.
- **Audio**: A single MP3 (`/intro.mp3`, ~7s John Walton Stanley Cup call)
  plays once when the user clicks Enter on the splash screen.

## Page structure

- **Splash overlay** — full-screen on first visit per session. Two-column
  background (championship photos via 4-tile grid in `/images/cup1-4.jpg`),
  big logo, "CLICK TO ENTER" button. Sets sessionStorage to skip on
  subsequent loads in the same tab.
- **Home** (`#page-home`) — Hero (logo + Browse/About buttons over Ovi
  background), 5-stat strip (Items / Jerseys / Sticks & Equipment / Cards
  & Autos / Total Pictures), editable About blurb, Featured Pieces grid.
- **Browse** (`#page-browse`) — 11 category tiles. Admin can drag to
  reorder. Click a tile → either the sub-gallery list page (jerseys,
  sticks, etc.) or directly into the media view (single-gallery
  categories like cards, autographs).
- **Sub-gallery list** (`#page-gallery`) — grid of player tiles within a
  category. Admin can drag to reorder. Has a category-list-intro for
  non-singleGallery categories (Sticks, Pucks, Jerseys, Equipment) with
  editable title and body.
- **Sub-gallery / media view** (`#page-subgallery`) — for a specific
  player or a single-gallery category. 3-column row at top (bio left,
  hero photo middle, "About This Jersey/Stick/Puck" details right).
  Below is the media grid. SingleGallery categories show a category-intro
  here instead of the bio row.
- **About** (`#page-about`) — 3-column layout: photo masonry left, About
  text and YouTube poster middle (click-to-load), photo masonry right.
  15 personal photos in `/images/about-1..15.jpg`.
- **Wants** (`#page-contact`) — Used to be a Contact form; rewritten to be
  a "Wants" list. Editable list of pieces Jay's looking to acquire, plus
  an editable email line. Two photos as faded backdrop on left/right
  (the Wilson photos that originally lived on the About page, embedded
  as base64).

## Admin login

Triple-click the nav logo, type the password (in source: it's stored as a
constant near `tryLogin()` in the script — find `ADMIN_PASSWORD`). On
correct entry, body gets `admin-mode` class. All admin-only controls
become visible (drag handles, "Set Cover" buttons, inline-editable text
outlines, etc.). Logout via the admin bar. Admin state is per-tab
(no persistence) — closing the tab logs you out.

The admin bar (bottom-right when logged in) has these buttons:

- **SmugMug Settings** — credentials modal (already configured server-side).
- **Reset Local Cache** — wipes `capsVaultCollection` + `capsVaultHomePhotos`
  in localStorage and hard-reloads with a cache-buster query string.
  Use when devices look out of sync. Preserves `admin:cover` and
  `admin:delete` marks.
- **KV Debug** — opens a new tab with a per-category dump of
  `KV` (album URLs), `COVER` (with ✓/✗ for each gallery indicating
  whether a cover is saved in KV), `LS` (localStorage), and `MEM`
  (current `collectionData`). Top of report lists every KV key with
  no cover.
- **Delete KV Key** — prompts for an exact KV key (e.g.
  `captains-autos__Captain's Autographs`) and calls `delete-gallery`.
  Use for surgical cleanup the × button can't reach — duplicates inside
  a singleGallery category, etc.
- **Log Out**.

## KV schema (everything in `CAPS_VAULT_KV`)

| Key pattern               | Type    | Purpose                                                                                |
| ------------------------- | ------- | -------------------------------------------------------------------------------------- |
| `<catId>__<playerName>`   | string  | SmugMug album URL for a sub-gallery. Used by `loadFromKV()` to populate items.         |
| `cover:<catId>__<player>` | string  | Per-sub-gallery cover photo URL (set via the lightbox "Set Cover" button).             |
| `phero:<catId>__<player>` | string  | Per-player hero image URL on the gallery page (set via "Set as Player Hero").          |
| `pheropos:<catId>__<player>` | string | CSS object-position string for the player hero (set via drag-to-reposition).         |
| `portfolioCovers`         | JSON    | `{ catId: coverUrl }` — covers for the Browse-page category tiles.                     |
| `portfolioOrder`          | JSON    | `[catId, catId, ...]` — admin-chosen order of category tiles on Browse.                |
| `galleryOrders`           | JSON    | `{ catId: [playerName, playerName, ...] }` — order of sub-galleries within categories. |
| `featured`                | JSON    | `[{src, caption, categoryId, playerName}, ...]` — Featured Pieces lineup on Home.      |
| `texts`                   | JSON    | `{ editId: text }` — every inline-edited text on the site (bios, paragraphs, photo metadata, category intros, all of it). |
| `stats`                   | JSON    | `{ photos, total, jerseys, equip, cards }` — last-computed home-page stat numbers, displayed instantly on page load while `loadFromKV` runs in background. Re-saved when `loadFromKV` completes. |

`functions/api/smugmug.js` filters all the prefix and special keys out of
the `list` action so the album-URL query stays clean (covers, phero,
pheropos, featured, texts, portfolioCovers, galleryOrders, portfolioOrder,
stats).

### API endpoints (all on `functions/api/smugmug.js`)

Every endpoint takes `?action=<name>` and follows a `save-<thing>` /
`list-<things>` naming convention. Notable additions:
- `delete-gallery` (POST `{key}`) — wipes album URL, cover, phero,
  pheropos, gallery-order entry, bio, pdetails, and any featured tile
  pointing at the gallery in one atomic call.
- `save-stats` / `list-stats` — home-page stats cache.
- All `list-*` endpoints accept `&_=<timestamp>` cache-busters; client
  appends `Date.now()` to every call so iOS Safari can't serve stale
  responses even if HTML is cached.

## Eventual consistency & admin-write protection

Cloudflare KV is **eventually consistent** — propagation across edge
locations can take up to ~60 seconds. A naive read-after-write loses
admin choices on the next reload. To handle this, every admin write is
mirrored to a TTL-stamped map in localStorage, and load functions skip
keys that the admin recently touched on this device.

- `localStorage['admin:cover']` — `{ key: timestamp }` map.
- `localStorage['admin:delete']` — same shape, for deleted galleries.
- `localStorage['admin:order']` — `{ catId: { order: [name,...], ts } }`
  map for sub-gallery ordering within a category. Different shape from
  the others (carries the full saved order, not just a timestamp)
  because the KV value itself may not have propagated yet on reload —
  we need the local copy of the order to apply, not just a "skip this
  key" hint.
- `ADMIN_WRITE_TTL_MS` = 10 minutes. After that, KV is authoritative
  again (well past the propagation window).
- `markRecentAdmin(kind, key)` and `isRecentAdmin(kind, key)` are the
  helpers (cover/delete only). `pruneAdminMarks()` runs at boot to
  trim expired entries (handles all three kinds, including the
  differently-shaped `admin:order`).

**Read-side guards:**
- `loadFromKV` skips any KV key in `isRecentAdmin('delete', key)`
- Cover-loading skips any KV key in `isRecentAdmin('cover', key)`
  AND in the in-memory `recentlySetCovers` Set.
- `loadGalleryOrdersFromKV` merges the `admin:order` local mirror on
  top of the KV response so a fresh-but-stale KV read can't undo a
  reorder the user just saved.

`Reset Local Cache` admin button wipes `capsVaultCollection` and
`capsVaultHomePhotos` BUT preserves the `admin:*` marks (so a user
clearing local cache for sync reasons doesn't lose recent-write
protection).

## Categories

Defined in the `portfolios` array near the top of the JS section.

Per-player categories (sub-galleries shown):
- `home-jerseys`, `away-jerseys`, `alt-jerseys` (jersey categories)
- `sticks`, `equipment`, `pucks` (other game-used)

Single-gallery categories (`singleGallery: true` flag, skips the
sub-gallery list and goes straight into the media view):
- `cards` (Game-Used Cards)
- `autographed-cards` (Autographed Cards)
- `captains-autos` (Captains Autographs — note: no apostrophe)
- `autographs` (Caps Autographs)
- `more` (More Caps Stuff)

**KV is the SOLE source of truth for which galleries exist.** As of
May 6, 2026 there are NO hardcoded gallery name arrays in the JS. To
create a new gallery, the admin uses the "+ New Gallery" button or
"Load from SmugMug" in the admin UI. To remove one, use the × delete
button on the sub-gallery card (or `Delete KV Key` for one-offs that
the × can't reach, like duplicates inside a singleGallery category).
**Do NOT re-add hardcoded `homeJerseyNames` / `awayJerseyNames` etc
arrays** — they cause ghost placeholder galleries that resurrect on
every page load and can't be deleted via the × button.

The category intro feature works on both: `category-intro` element shows
on `#page-subgallery` for singleGallery categories; `category-list-intro`
element shows on `#page-gallery` for the rest. Both pull from the same
KV `texts` blob using `cat-intro:<catId>` and `cat-intro-title:<catId>`.

## Inline-edit system

Every editable element has a `data-edit-id` attribute. When admin is
logged in, those elements get a gold dashed outline, become
`contentEditable`, and auto-save on blur (or Escape) via the
`save-text` endpoint. Press Enter for new lines.

Photo-level metadata uses dynamic edit IDs based on the photo's SmugMug
URL (`photo-title:<url>`, `photo-year:<url>`, `photo-notes:<url>`),
applied in `renderLightboxItem()`.

Player bios: `bio:<playerName>`. Player details panel:
`pdetails:<catId>__<playerName>`. Category intros:
`cat-intro:<catId>` and `cat-intro-title:<catId>`.

## Player gallery layout (3-column)

Inside each player gallery, the bio row is a 3:4:3 flex layout:
- Left (flex 3, ~30%): bio text — editable, with red accent header
- Middle (flex 4, ~40%): hero image — drag-to-reposition for admin,
  `object-position` saved per player
- Right (flex 3, ~30%): "About This Jersey/Stick/Puck/Item" details
  panel — editable, dark navy bg with red left border

Stacks vertically on ≤900px (image first, then details, then bio).

## Search

Magnifying-glass button in nav, or `/` or `Cmd-K` keyboard shortcut.
Currently searches gallery names only. Photo metadata is NOT indexed —
that's the next obvious enhancement (would mean typing "2018" or
"puck" finds specific items).

## Important gotchas

- **Sandbox can't delete files** in `.git/objects/` or remove
  `.git/*.lock` files. So most commits run by Claude end with a lock
  warning. Tell the user to run:
  ```
  rm .git/index.lock .git/HEAD.lock 2>/dev/null
  git commit -am "..."
  git push
  ```
  This is normal — not a real failure.
- **Network is blocked from sandbox**: Claude can't `git pull/push`
  or hit external URLs from its bash. The user has to push.
- **Image uploads via chat don't work as files** — when the user pastes
  images in chat they show up but aren't saved to the filesystem. They
  need to drag actual files into the chat OR save them into
  `~/Documents/GitHub/caps-vault/images/` directly. Then Claude can
  see them.
- **Lock files block git commits**: even after the user pushes,
  sometimes a stale `.git/index.lock` blocks the next commit. Always
  `rm -f .git/index.lock .git/HEAD.lock 2>/dev/null` at the start of
  any commit script.
- **Comments in JS**: there's a stray-looking JS pattern near
  `loadCollection` that LOOKED like a syntax error (single `/`
  instead of `//`) but `cat -A` confirmed they are normal `//` comments
  — Grep just rendered them oddly. Don't "fix" them.
- **The admin password** is in plaintext in `index.html`. The user
  accepts this security trade-off. Don't move it elsewhere or try to
  hash it without explicit permission.
- **iPhone screenshots have non-breaking-space characters** in their
  filenames (e.g. "Image 5-2-26 at 9.16 PM.jpeg" has U+202F before
  "PM"). Bash glob patterns (`Image\ *`) work; explicit filename
  paths often don't. Use python or glob expansion to handle them.
- **iOS Safari aggressive HTML caching** — handled by `_headers` file
  at the repo root which sets `Cache-Control: no-cache, must-revalidate`
  on `/` and `/index.html`, and `no-store` on `/api/*`. If you ever
  remove this file, Safari users will be stuck on stale HTML for hours.
- **Cloudflare KV is eventually consistent (~60s).** Don't read
  immediately after a write and expect the new value globally — for
  same-edge reads it's usually sub-second, but cross-region or after
  a delete the list call may still return the old keys. Mitigated by
  the `admin:cover` / `admin:delete` localStorage TTL marks (see
  "Eventual consistency" section).
- **`loadFromKV` MUST apply covers in its first pass.** Earlier we had
  a separate `loadCoversFromKV()` that ran in parallel — it could
  resolve before galleries were pushed to `collectionData`, find
  nothing in `find(g => g.name === playerName)`, and silently drop the
  cover. The fallback to `items[0]` then won permanently. Now
  `loadFromKV` fetches the cover map alongside the gallery list and
  applies them synchronously while pushing each gallery. The standalone
  `loadCoversFromKV` function still exists but isn't called from boot.
- **The file is ~1MB+** — direct `Read` on the whole index.html
  exceeds token limits. Use `offset`/`limit`, `Grep`, or `awk`/`sed`
  via bash to navigate it. The base64-embedded covers/logos/images
  in the file (especially around lines 2880-2890 and the
  `niskanenCover` removal area) make line-range reads blow up if
  you span them.

## How Jay likes to work

- He iterates fast — small change, see it on the live site, request a
  tweak. Don't over-engineer.
- He prefers visual changes confirmed via push + deploy + look — not
  dumping huge specs.
- He's not a developer but is patient with the lock-file dance and
  has gotten comfortable with simple terminal commands.
- Keep responses concise and action-oriented. He doesn't want
  walls of bullet-pointed explanation when a 2-line confirmation
  works.

## Recent work (May 2026)

Major features built (in rough order):
1. Bug fixes to gallery thumbnails on first visit + cover persistence.
2. KV-synced covers, featured pieces, gallery orders, portfolio order,
   player heros, hero positions.
3. Inline-editable text (about/contact/bios), expanded to include
   photo-level metadata (title/year/notes), category intros (with
   editable titles and body), and "About This Jersey" per-player
   details panel.
4. Splash page with John Walton Cup-call audio (plays once per session,
   sessionStorage-gated).
5. Search (live, by gallery name, with `/` and `Cmd-K` shortcuts).
6. Drag-and-drop reordering for both sub-galleries within a category
   and the category tiles themselves.
7. Browse-page category covers (Set as Browse Cover button in lightbox).
8. Player hero image with admin drag-to-reposition (SmugMug-style
   object-position adjustment, saved per-player).
9. Wants page (replaced Contact); single-gallery categories (Cards,
   Autographs, etc.) that skip the sub-gallery list page.
10. Mobile hero polish: large logo upper-left, photo behind, buttons
    at bottom, all sized to feel right.
11. About page collage (15 photos in 3-column layout: photos / text /
    photos), YouTube click-to-load poster.
12. 5-stat strip on Home (counts physical pieces, not photos, for
    jerseys/sticks/equipment; counts items for the singleGallery cards/autos
    bucket; plus a Total Pictures bucket for the raw count).

### May 6, 2026 session (long session, lots fixed)

13. Admin × delete button on each sub-gallery card — wipes the album URL,
    cover, hero, hero position, gallery-order entry, bio + pdetails text
    overrides, and any Featured tile pointing at the gallery. New
    `delete-gallery` API endpoint.
14. **KV is now the sole source of truth for gallery existence.** Removed
    all four hardcoded gallery name arrays (`homeJerseyNames`,
    `awayJerseyNames`, `altJerseyNames`, `equipmentNames`) and the
    `niskanenCover` base64 blob. Was causing ghost placeholder galleries
    that resurrected on every page load.
15. **Eventual-consistency protection.** Admin writes (covers, deletes)
    now mirror to `localStorage['admin:cover']` and
    `localStorage['admin:delete']` with a 10-min TTL. Read paths skip
    keys with active marks so a slow KV propagation can't undo the
    user's choice. Survives page reloads on the same device.
16. **loadFromKV race fix.** Was the actual bug behind "stick covers
    keep reverting." `loadCoversFromKV` resolved before galleries were
    pushed to `collectionData`, dropped covers silently, and the
    fallback to `items[0]` won. Fixed by integrating cover-loading into
    `loadFromKV`'s first pass — covers and gallery registration happen
    in the same synchronous loop now.
17. **Parallelized `loadFromKV`.** Was one SmugMug fetch at a time
    sequentially. Now uses a worker pool with `CONCURRENCY = 8`. Big
    speedup for large categories.
18. **Home stats KV cache.** New `stats` KV key. On page load, cached
    stats paint instantly from a single fast fetch. Re-saved when
    `loadFromKV` finishes a full crawl. Without this, stats were "—"
    until SmugMug crawl finished (~30s).
19. **Cache-busters on all `list-*` API calls** (`&_=Date.now()`) plus
    `_headers` file with `Cache-Control: no-cache, must-revalidate`
    on HTML and `no-store` on `/api/*`. Fixes iOS Safari serving
    stale data.
20. **Mobile delete-button visibility.** `@media (hover: none) {
    .sg-delete-btn { opacity: 0.95 } }` — was invisible on touch
    devices because the rule was `:hover`-only.
21. **Admin tools added:** Reset Local Cache, KV Debug (opens in new
    tab, shows ✓/✗ for each gallery's cover status), Delete KV Key
    (one-off cleanup for keys the × button can't reach).
22. **Cover save now awaits and alerts on failure.** Previously a
    silent `.catch` for fire-and-forget. Now the user sees a popup if
    the API returns non-OK so silent failures are visible.
23. **deleteSubGallery now calls saveCollection().** Without this,
    localStorage kept the deleted gallery and `loadCollection`
    restored it on reload (combined with KV propagation lag, that's
    why deletes "didn't stick").

### May 10, 2026 session

24. **Gallery-order revert fix.** Drag-reordering home/away/alt jersey
    galleries didn't stick across reloads. Cause: the May 6 cache
    busters on `list-gallery-orders` exposed a KV propagation race —
    a reload landing within ~60s of the save would fetch a stale order
    from a different edge and `loadGalleryOrdersFromKV` would apply
    it, undoing the change. Before May 6, browser HTTP caching of the
    response was masking the race. Fix: added `localStorage['admin:order']`
    mirror written by `saveGalleryOrder`, merged on top of the KV
    response in `loadGalleryOrdersFromKV` for any catId still within
    the 10-min TTL. Same pattern as `admin:cover`/`admin:delete` but
    the value carries the full saved order, not just a timestamp,
    because the saved order itself may not have propagated.
    `pruneAdminMarks` now also sweeps the `admin:order` map.
    `loadGalleryOrdersFromKV` also gained a `renderSubGalleryGrid()`
    call so the new order is visible immediately if you're looking
    at the gallery list when load completes.

25a. **Inline-edit broke after login because of an unrelated throw.**
    Symptom: admin-mode gold outline showed on hover, but text wasn't
    contentEditable. Cause: `tryLogin()` unconditionally calls
    `renderMediaGrid()` and `renderSubGalleryGrid()` AFTER setting
    `admin-mode` but BEFORE `enableTextEditing()`. Both renderers
    dereferenced `collectionData[currentPortfolio][currentSubGalleryIndex]`
    /`collectionData[currentPortfolio]` without guards. If the admin
    logged in while not inside a specific subgallery (e.g. from the
    home page or the gallery list), the index lookup returned
    `undefined`, then `sg.items.forEach` threw "undefined is not an
    object (evaluating 'sg.items')". The throw aborted tryLogin —
    `enableTextEditing()` never ran, so the existing CSS outline
    appeared on hover but contenteditable was never applied. Fix:
    both renderers now bail early if `currentPortfolio`/
    `currentSubGalleryIndex` are null or the lookups don't resolve.

25. **Gallery-order race in fresh browsers (incognito / first visit).**
    Initial fix above only helped the admin's own browser. In a fresh
    browser, `loadCollection()` finds nothing in localStorage so
    `collectionData[catId]` starts empty. `loadGalleryOrdersFromKV`
    only has one fetch (vs `loadFromKV`'s `Promise.all` of two), so
    it resolved FIRST — tried to reorder an empty array — did
    nothing — then `loadFromKV` pushed galleries in KV `list()`
    alphabetical order. Visitors saw alphabetical, not the admin's
    chosen order. Fix: `loadFromKV` now awaits `loadGalleryOrdersFromKV()`
    at the end of its first pass (after pushing every gallery into
    `collectionData`), and the standalone boot call to
    `loadGalleryOrdersFromKV` was removed. Same pattern as the
    May 6 cover-race fix — order-application moved inside
    `loadFromKV` to guarantee ordering against fresh state.

## Roadmap (not yet built — Jay's interested but pending)

- **Search indexing photo metadata** (highest value next step; lets
  visitors find by year, photo title, notes, etc.)
- **Open Graph / per-page titles** for social sharing previews.
- **Recently Added strip** on the home page.
- **Year filter / timeline view** (depends on having photo years tagged).
- **Mobile-friendly reordering** (current drag is desktop-only).
- **Custom 404 page**.
- **Cloudflare Web Analytics** (free, no cookies).
- **Periodic KV backup export** for safety.

## File map

```
/index.html                      ← THE WHOLE SITE (~1MB+)
/_routes.json                    ← Pages routing (only /api/* hits Functions)
/_headers                        ← Cache-Control headers (no-cache HTML, no-store API)
/intro.mp3                       ← John Walton Cup call (7s)
/functions/api/smugmug.js        ← The Pages Function (only backend)
/functions/smugmug.js            ← Older copy, not actively used (routes
                                   to /smugmug, but _routes.json doesn't
                                   include it)
/images/
   cup1.jpg ... cup4.jpg         ← Splash backdrop (championship photos)
   about-1.jpg ... about-15.jpg  ← About page collage personal photos
   warehouse-poster.jpg          ← About page YouTube click-to-play poster
```

## When user asks for help

- They will often paste a screenshot describing a layout problem on
  mobile — read the screenshot, find the relevant CSS in the
  responsive media queries (`@media (max-width: 768px)` etc.), and
  make targeted CSS-only fixes. The desktop layout is generally good
  and shouldn't be touched.
- If they ask about new content (player bios, intros, write-ups for
  specific pieces), draft suggested copy yourself and offer to drop
  it into the inline-edit slot. They'll typically tweak.
- Heavy-handed refactors are not welcome. The site has grown
  organically and the file is intentionally one HTML page. Keep it
  that way unless explicitly asked to split.
