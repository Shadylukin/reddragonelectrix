# Red Dragon Electrix

Website for Red Dragon Electrix Limited — registered electricians, Auckland NZ.

Static site built with [Astro](https://astro.build), hosted on Cloudflare Pages.
No database, no CMS, no plugins, nothing to patch.

## Why it was rebuilt

The previous site was WordPress with 13 plugins and a page builder. On **7 April 2024** a
round of plugin and core updates was applied. Two days later every record in the database
stops — the last enquiry, the last scheduled task, everything. **The site was dead for 28
months and nobody noticed**, because nothing was monitoring it and silence looked identical
to "business is quiet."

Cost of that outage, from the enquiry data: the form averaged **7.4 enquiries/month** and was
trending up (8–14/month in its last six months) before it died. Roughly 220 enquiries lost.

Two design consequences, both deliberate:

1. **Static.** No update path means no botched update. It cannot fail the way the old one did.
2. **Monitored.** Uptime and content checks, so a silent death is caught in a day, not two years.

## Positioning

The old site led with *"West Auckland's Most Reputable Electricians"*. The enquiry data said
that was wrong on both counts:

- **80% of enquiries (77 of 96) were EV / Tesla charger installations**
- Roughly half the named locations were outside West Auckland — Hobsonville was the single
  biggest suburb, then Epsom, Remuera, Parnell, Northcote, Papakura

So the site now leads with EV charging and serves all of Auckland. General electrical sits
underneath.

## Develop

```sh
npm install
npm run dev        # localhost:4321
npm run build      # -> dist/
npm run deploy     # build + push to Cloudflare Pages
```

## Structure

```
src/data/site.ts       single source of truth for every business fact
src/layouts/Base.astro head, meta, Electrician schema, view transitions
src/pages/             index, [slug] (services), contact, 404
public/img/            photography, extracted from the old media library
holding/               the interim holding page (currently live)
```

**Change business facts in `src/data/site.ts` only.** Phone number, hours, service area and
schema all derive from it. The old site had the phone number hardcoded in about nine places.

Values that are genuinely unknown are `null` with a `TODO`, and are omitted from the output
rather than guessed — an invented opening hour or registration number is worse than a missing one.

## Still to confirm with the owner

- EWRB registration number
- Whether he carries public liability insurance
- Whether `nick@reddragonelectrix.co.nz` should become a real mailbox rather than a forward
