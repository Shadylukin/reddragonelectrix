# Data — what's held, where, and who's responsible

Red Dragon Electrix collects personal information through the website. Under the
**Privacy Act 2020** that is Nick's responsibility as the business, not the developer's.
This document exists so nobody has to reverse-engineer the answer later.

## What is collected

Every enquiry stores, in Cloudflare **D1** (`rde-enquiries`, database `e2b496de-…`):

| Field | Source | Personal info? |
|---|---|---|
| name, phone, email, suburb | typed by the customer | **yes** |
| message | typed by the customer | **yes**, and free-text — may contain anything |
| job type, EV vehicle / charger / distance / property | typed by the customer | no |
| `ok_to_text` | explicit checkbox | consent record |
| `ai_summary`, `ai_priority` | Gemini 3.7 Flash, derived from the above | **yes**, derived |
| `user_agent`, `source_page`, `created_at` | request headers | low sensitivity |

**Not collected:** no analytics, no cookies, no tracking pixels, no IP logging beyond
Cloudflare's own edge logs. The site sets no cookies at all, which is why there is no
cookie banner.

## Where it goes

```
customer → Cloudflare Pages Function (NZ/AU edge)
             ├── D1                          primary record, retained
             ├── Gemini 3.7 Flash (Google)   name/phone/suburb/message sent for triage
             └── rde-notify Worker
                   └── Cloudflare Email Routing → dragonelectrix@gmail.com
```

**Two third parties see customer data:** Google (the triage call) and Google again
(Gmail, as the destination inbox). Cloudflare processes it as the host.

The Gemini call sends the enquiry fields listed above. Google's paid API tier does not
train on submitted data — but this is worth re-checking if the plan or provider ever
changes, because it is the sort of term that moves.

## Retention

**Nothing is deleted automatically yet.** That's a gap, and it is deliberate rather than
overlooked: at ~8 enquiries a month it will be years before volume matters, and the
right retention period is a business decision Nick should make, not a default someone
picked.

Recommended: **delete enquiries older than 24 months.** Long enough to look up a past
job, short enough to limit exposure. One scheduled query when someone decides.

For context, the old site accumulated **96 enquiries over 14 months and kept every one
indefinitely** — they were still sitting in the database, with names, emails and
messages, when the backup was handed over 28 months later. Those records now exist in a
`.sql` file on at least two laptops. **They should be deleted once the migration is
finished.**

## Access

- **Cloudflare account** — currently `lukinack@gmail.com`. Anyone with that login can
  read every enquiry. If the account owner changes, this is the thing that moves.
- **The Gmail inbox** — Nick.
- **`wrangler d1 execute`** from any machine with an authenticated CLI.

There is no admin UI, by design. One fewer surface, one fewer login, one fewer thing to
patch. Reading the data means running a query.

```sh
# recent enquiries
wrangler d1 execute rde-enquiries --remote \
  --command="SELECT created_at, name, phone, suburb, job_type, ai_priority, notify_status FROM enquiries ORDER BY created_at DESC LIMIT 20;"

# has anything arrived lately?
curl https://reddragonelectrix.co.nz/api/enquiry
```

## Backups

D1 is replicated by Cloudflare. There is **no independent export**, which means a
Cloudflare account problem is a total-loss scenario for enquiry history. Given the
value of that history — the entire diagnosis of what killed the old site came from
exactly this kind of data — a periodic export is worth adding.

## If a customer asks for their data, or asks for it deleted

They have that right under the Privacy Act. Both are single queries:

```sh
# what do we hold on this person
wrangler d1 execute rde-enquiries --remote \
  --command="SELECT * FROM enquiries WHERE email='them@example.com' OR phone='021…';"

# delete it
wrangler d1 execute rde-enquiries --remote \
  --command="DELETE FROM enquiries WHERE email='them@example.com';"
```

Note the notification email will already be in Nick's Gmail and is not covered by that
delete. A complete erasure means clearing the Gmail thread too.

## Still outstanding

- [ ] Nick to decide a retention period; implement as a scheduled delete
- [ ] Delete the old WordPress `.sql` dumps once migration is signed off
- [ ] Periodic D1 export to somewhere outside Cloudflare
- [ ] A privacy statement on the site — the old one was written and **never published**,
      which is a worse position than not having written one
