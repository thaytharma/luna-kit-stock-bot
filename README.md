# luna kit stock bot

Watches product pages and pushes a notification the moment a sold-out item is
back in stock.

Default target: the **Leander Luna conversion kit for the 140 cm cot**, watched
at both shops that sell it:

| Shop | Product page |
| --- | --- |
| [kids-world.dk](https://www.kids-world.dk) | [Leander Luna Ombygningssæt Til Babyseng – 140 cm – Hvid](https://www.kids-world.dk/leander-luna-ombygningssaet-til-babyseng-140-cm-hvid-p-261365.html) |
| [csmegastore.no](https://www.csmegastore.no) | [Ombyggingssett til Luna™ babyseng 140 cm – Hvit](https://www.csmegastore.no/i/24512506/ombyggingssett-til-luna-babyseng-140-cm-hvit) |

kids-world's customer service confirmed the kit is on their replenishment list
with no ETA. Both are sold out as of August 2026.

It also watches **second-hand ads on [finn.no](https://www.finn.no)** and pushes
an alert when a new Leander Luna listing appears — see
[finn.no search watching](#finnno-search-watching).

## How it works

The product pages are server-rendered, so no headless browser is needed. Each
shop has its own adapter in `src/sites/`, because **they do not share a single
stock signal** — see the csmegastore trap below. Every adapter reads two
**independent** signals and reports which ones it saw.

### kids-world.dk

1. **The status marker**

   | HTML | Meaning |
   | --- | --- |
   | `stockStatusBullet--in_stock` → `På lager` | in stock |
   | `stockStatusBullet--not_in_stock` → `Udsolgt` | sold out |

   Only the class modifier is read, never the label — the label varies
   (`På lager`, `På lager - Sendes indenfor 24 timer`).

2. **The `Læg i kurv` button** (`<button class="... cartAddProduct">`), which the
   server omits entirely when the item cannot be bought.

Verified across 45 live pages — 40 in stock, 5 sold out — with zero
disagreements between the two signals.

### csmegastore.no

1. **The schema.org offer availability**

   | HTML | Meaning |
   | --- | --- |
   | `<meta itemprop="availability" content=".../InStock">` | in stock |
   | `<meta itemprop="availability" content=".../OutOfStock">` | sold out |

2. **The stock bullet colour** (`<span class="stock green">`)

   | Colour | Meaning |
   | --- | --- |
   | green | in stock |
   | yellow | `Fjernlager` / few left — still orderable, so in stock |
   | red | `Ikke på lager` |

Verified across 49 live pages — 45 in stock (39 green, 6 yellow), 4 sold out
(all red) — with zero disagreements.

> **The add-to-basket button is deliberately *not* a signal here.** This shop
> renders `Legg i handlevogn` on every product page, including sold-out ones.
> Reusing kids-world's "cart button ⇒ buyable" rule would report the watched kit
> as in stock on every single run. This is pinned by a regression test.

Non-product URLs on this shop answer `200` with the site chrome and no product
markup, which reads as `unknown` and so trips the broken-bot warning rather than
looking like a permanent "sold out".

### Why either signal is enough

Each shop's two signals are combined in favour of catching a restock, because the
costs are asymmetric: a false alarm wastes one click, a missed restock loses the
product. So if *either* signal says the item is buyable, the bot notifies.

| signal A | signal B | result | wording |
| --- | --- | --- | --- |
| in stock | in stock | in stock | "På lager nu!" |
| sold out | sold out | sold out | silent |
| in stock | sold out | in stock | "Måske på lager" + which signals disagreed |
| sold out | in stock | in stock | "Måske på lager" + which signals disagreed |
| unknown | in stock | in stock | "Måske på lager" + which signals disagreed |
| unknown | sold out | unknown | see below |

Only when **neither** signal indicates something buyable *and* they do not agree
does the bot conclude nothing. After three consecutive such checks (or fetch
failures) it notifies **you** that it is probably broken. A scraper that silently
stops working is what would actually cost you the kit.

On kids-world.dk, sold-out products are hidden from the site's own search and
category listings, which is why that target is reachable only by direct URL.

Alerts stay in Danish for both shops and name which shop the product turned up
in; the Norwegian shop's price is reported in NOK.

### Notification rules

| Transition | Action |
| --- | --- |
| → in stock (not yet notified for this streak) | 🚨 priority-5 push + email, links to the product |
| in stock → in stock (already notified) | silent |
| → sold out | silent, and re-arms the next restock alert |
| 3× consecutive unknown / fetch failure | ⚠️ one "bot may be broken" alert |

Each URL is tracked independently, so the two shops notify separately.

`state.json` is committed back by the workflow so state survives between runs. A
notification is only recorded as sent if at least one channel accepted it —
otherwise it retries on the next run.

### finn.no search watching

A second-hand marketplace has no page that comes "back in stock", so finn.no is
watched differently: the bot reads a saved search and alerts on any ad id it has
not seen before.

Default search: [`"leander luna"`, newest first](https://www.finn.no/recommerce/forsale/search?q=%22leander+luna%22&sort=PUBLISHED_DESC).
It is broader than the kit on purpose — a used cot sold with its conversion kit
is just as useful. The quotes matter: unquoted, finn.no also returns every
Leander cradle.

The search page is server-rendered and embeds its results as base64 JSON in
`<script data-react-query-state>`. Each ad carries an id, heading, price and URL.

> **finn.no pads results with "semantic" matches.** A search for
> `luna ombyggingssett` returned 53 ads, 51 of them hole saws, wool sweaters and
> similar, tagged `metadata.source: "semantic"`. Those are dropped; only ads
> tagged `keyword` or `both` count. This is pinned by a test on the real page.

| Situation | Action |
| --- | --- |
| first successful read of a search | remember every ad already listed, silent |
| one new ad | 🔍 priority-5 push + email, links to the ad |
| several new ads | one alert listing up to 5, links to the search |
| ads disappear (sold / removed) | silent; their ids are kept so a relisting doesn't re-alert |
| 3× consecutive unreadable page / fetch failure | ⚠️ one "bot may be broken" alert |

A page without the search data throws instead of reading as "no hits", so a
layout change shows up as a broken-bot alert. If no channel accepts an alert, the
new ads are not marked as seen and the next run alerts again.

Only the first page of results is read, which is why the search is sorted
newest first. If you set your own search, keep `sort=PUBLISHED_DESC`.

**Not supported: Amazon and eBay.** Both refuse plain requests (Amazon answers
`503` with a CAPTCHA, eBay `403`), and GitHub Actions IP addresses fare worse.
eBay could be added through its official Browse API with a free developer key.
Amazon has no practical option.

## Setup

The bot runs on GitHub Actions every 15 minutes. Configure these in
**Settings → Secrets and variables → Actions**.

### Secrets

| Secret | Required | Notes |
| --- | --- | --- |
| `NTFY_TOPIC` | for push | Your ntfy topic. **Treat it as a password** — anyone who knows it can read and post to it. Use something unguessable, e.g. `kw-leander-7f3a91`. |
| `SMTP_HOST` | for email | e.g. `smtp.gmail.com` |
| `SMTP_PORT` | no | Defaults to `587`. Use `465` for implicit TLS. |
| `SMTP_USER` | for email | SMTP username |
| `SMTP_PASS` | for email | SMTP password. Gmail requires an [app password](https://myaccount.google.com/apppasswords), not your account password. |
| `MAIL_TO` | for email | Recipient(s), comma-separated |
| `MAIL_FROM` | no | Defaults to `SMTP_USER` |

Each channel is independent: configure one or both. A missing channel is skipped,
and one channel failing never silences the other.

### Variables

| Variable | Notes |
| --- | --- |
| `PRODUCT_URLS` | Comma-separated product URLs. **Overrides the defaults entirely** — if you set it, list every URL you want watched. Leave it unset to watch both shops' Luna kit. |
| `SEARCH_URLS` | Comma-separated finn.no search URLs. **Overrides the default search entirely.** Build the search on finn.no (filters like price or location carry over in the URL) and copy the address. Keep `sort=PUBLISHED_DESC`. |
| `NTFY_SERVER` | Defaults to `https://ntfy.sh`. Set only if self-hosting. |

Only kids-world.dk and csmegastore.no URLs can be parsed. A URL from any other
host fails loudly rather than being guessed at, so it shows up as a broken-bot
alert instead of a product that silently never restocks.

### Receiving the push

Install the ntfy app ([iOS](https://apps.apple.com/us/app/ntfy/id1625396347) /
[Android](https://play.google.com/store/apps/details?id=io.heckel.ntfy)) and
subscribe to the same topic you put in `NTFY_TOPIC`.

### Verifying the setup

Don't wait for a real restock to find out whether the wiring works:

**Actions → Check stock → Run workflow → tick "Send a test notification"**

That sends a test push/email through every configured channel and touches no
state. Locally the same thing is `TEST_NOTIFICATION=1 pnpm check`.

## Local use

```sh
pnpm install
pnpm test         # 185 tests
pnpm typecheck
pnpm check        # one check run against the live sites
```

Put credentials in a `.env` file (gitignored) and run:

```sh
node --env-file=.env node_modules/.bin/tsx src/index.ts
```

`STATE_PATH` overrides where state is written, which is handy for local runs:

```sh
STATE_PATH=/tmp/state.json pnpm check
```

## Caveats

- **Actions cron is best-effort.** Runs can be delayed by several minutes under
  load, so a restock that sells out fast could still be missed. The schedule is
  offset off the top of the hour to reduce this.
- **GitHub disables scheduled workflows after 60 days of repository inactivity.**
  The bot's own `state.json` commits may not reset that timer. GitHub emails you
  before disabling — push any commit, or re-enable it from the Actions tab.
- Each parser is specific to one shop's markup. Adding a retailer means adding
  one adapter in `src/sites/` and registering it; the fetch, notification and
  state layers are generic. Don't assume a new shop's signals resemble an
  existing one's — csmegastore.no is the cautionary example.
