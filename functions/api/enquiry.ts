/**
 * Enquiry intake for Red Dragon Electrix.
 *
 * ORDER OF OPERATIONS IS THE WHOLE DESIGN:
 *
 *   1. validate
 *   2. WRITE TO D1                 <- durable. everything after this is a bonus.
 *   3. ask the model to triage     <- best effort. failure is recorded, not fatal.
 *   4. email Nick                  <- best effort. failure is recorded, not fatal.
 *   5. respond 200 to the customer if and only if step 2 succeeded
 *
 * The previous site's form emailed and stored nothing durable. When it broke in
 * April 2024 there was no record that it had broken, and no record of the
 * enquiries that never arrived. Nobody noticed for 28 months. This endpoint is
 * built so that the only way to lose an enquiry is to lose the database.
 *
 * The model NEVER quotes a price and NEVER replies to the customer. It writes a
 * one-paragraph briefing for Nick and assigns a priority. That is all.
 */

interface Env {
  DB: D1Database
  GEMINI_API_KEY?: string
  /** The rde-notify Worker. Pages cannot hold a [[send_email]] binding; Workers can. */
  NOTIFY_URL?: string
  NOTIFY_SECRET?: string
  /** Optional fallback if we ever move off Cloudflare Email Routing. */
  RESEND_API_KEY?: string
}

const MODEL = 'gemini-3.7-flash'
const NOTIFY_TO = 'dragonelectrix@gmail.com'
const NOTIFY_FROM = 'enquiries@reddragonelectrix.co.nz'

/** Field length caps. Anything longer is a bot or a mistake. */
const LIMITS: Record<string, number> = {
  name: 120, phone: 40, email: 160, suburb: 80, jobType: 24, message: 4000,
  evVehicle: 80, evCharger: 80, evDistance: 80, evProperty: 40, sourcePage: 200,
}

function clean(v: unknown, field: string): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim().replace(/\s+/g, ' ')
  if (!s) return null
  return s.slice(0, LIMITS[field] ?? 200)
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}

interface Photo { name: string; type: string; b64: string }

/**
 * Ask the model for a briefing. Returns null on any failure — never throws.
 *
 * Photos are included when supplied. The vision read goes to NICK ONLY, never to
 * the customer — he is looking at the same photograph and is the registered
 * expert, so he can judge a wrong reading instantly. The reverse (a machine's
 * verdict on a stranger's switchboard, printed on their screen, under his
 * registration) is the one thing the design review flatly vetoed.
 */
async function triage(
  env: Env,
  e: Record<string, unknown>,
  photos: Photo[] = [],
): Promise<{ summary: string; priority: string; draftReply: string | null } | null> {
  if (!env.GEMINI_API_KEY) return null

  const prompt = `You are ALICE. You read the enquiries that come through the website for Nick, a
registered electrician in Auckland, New Zealand (Red Dragon Electrix), and you
write them up for him. He reads what you send on his phone between jobs, often
standing in someone's garage.

Write the summary TO NICK, directly, in second person — the way someone who took
the call would tell him. "You've got Sarah in Hobsonville after a Gen 3 for a
Model Y." Not "The customer has submitted an enquiry regarding..." Use the
customer's first name once you know it. Warm but brief; he is busy.

You may refer to yourself as I where it is natural ("I'd ask them for a photo of
the board"). Do not sign the summary — the email does that. And never introduce
yourself to a customer: the draft reply below is from NICK, in Nick's voice,
signed by Nick. You are writing to him, not for him.

RULES — these are absolute:
- NEVER estimate, suggest or imply a price. You do not know his rates.
- NEVER state whether the job is easy, hard, or how long it will take.
- If the enquiry is vague, say what he should ask. Do not guess the answer.
- No marketing language. Short.

NEW ZEALAND TRADE ENGLISH — get this right, he will notice immediately:
- NZ spelling throughout: specialise, organise, recognise, metre, colour,
  labour, licence (noun). Never the American -ize or -er forms.
- NZ trade vocabulary, not American:
    switchboard        NOT breaker panel / electrical panel / load centre
    power point        NOT outlet / receptacle
    RCD                NOT GFCI
    RCBO, MCB          NOT breaker (on its own)
    mains / supply     NOT service
    meter box          NOT meter can
    Certificate of Compliance (CoC), ESC   the NZ compliance documents
    AS/NZS 3000        the NZ wiring standard
    VIR, TPS           the cable types he actually deals with
    sparky             an electrician. Normal usage here, not slang.
    section            NOT yard
    torch              NOT flashlight
- Tone: plain, direct, understated. How one tradesman writes to another.
- DO NOT perform Kiwi-ness. No "sweet as", no "chur", no "bro", no "she'll be
  right". Laying slang on thick reads as a machine imitating a New Zealander and
  is worse than neutral English. The goal is simply to not sound American.
- BANNED PHRASES — corporate American, and a tradesman would never write them:
    "reaching out" / "reach out"     say: getting in touch, or just "thanks for the message"
    "touch base", "circle back"      say: give you a ring, get back to you
    "at your earliest convenience"   say: when you get a chance
    "please do not hesitate to"      say: just give me a ring
    "I hope this email finds you"    delete it entirely
    "utilise", "leverage"            say: use
  Openers that do work: "Thanks for the message", "Thanks for getting in touch",
  "Gidday" if it suits, or simply start with the answer. Sign off "Cheers, Nick".

Assign a priority:
  urgent   — a safety issue, whether the customer described one OR you can SEE one.
             Text: burning smell, sparking, smoke, shock, no power.
             Photos: visible burning or scorching, exposed or bare conductors,
             heavy corrosion or water damage, components hanging loose, an
             enclosure that will not close, obvious heat damage.
             The customer often does not know what they are looking at — that is
             why they are ringing an electrician. If the photo looks bad to you,
             flag it urgent even if the words are calm. Nick would rather look at
             a board that turned out fine than miss one that did not.
  standard — a real job enquiry with nothing alarming in the words or the photos
  info     — a question, a sales approach, spam, or nothing actionable

This flag is an internal triage signal for Nick, who is a registered electrician
looking at the same photograph. It is never shown to the customer, so raising it
costs nothing but Nick's attention and missing it can cost a great deal more.

ENQUIRY
name: ${e.name ?? '(not given)'}
phone: ${e.phone ?? '(not given)'}
email: ${e.email ?? '(not given)'}
suburb: ${e.suburb ?? '(not given)'}
job type: ${e.jobType ?? '(not given)'}
EV vehicle: ${e.evVehicle ?? '-'}
EV charger: ${e.evCharger ?? '-'}
board to parking distance: ${e.evDistance ?? '-'}
property type: ${e.evProperty ?? '-'}
message: ${e.message ?? '(none)'}

${photos.length ? `
PHOTOS: ${photos.length} attached, sent by the customer.
Add a short "In the photos:" line describing ONLY what is plainly visible — the
type of board, whether it looks modern or old, obvious spare ways, the run, where
the car sits. Rules for this line, absolute:
- Describe, never conclude. "Looks like a modern board with what may be spare
  ways" — never "there is capacity" and never "this needs upgrading".
- Never say anything is safe or unsafe. Nick decides that, on site.
- If the photo is unclear, dark, or you cannot tell, SAY SO plainly. "Can't tell
  from this angle" is a useful answer and a wrong guess is not.
- Nick is looking at the same photograph. You are saving him a squint, not making
  a judgement for him.` : ''}

ALSO WRITE A DRAFT REPLY for Nick to send the customer.

60% of enquiries arrive outside working hours, most of them between 5pm and
midnight — when he cannot ring but can tap out a reply from the couch. Speed of
first response wins jobs in the trades. This is a DRAFT: he reads it, changes
whatever he likes, and sends it himself from his own phone. Nothing you write
reaches a customer unless he sends it.

Rules for the draft:
- 3 or 4 sentences. If it is longer than he would type himself, it has failed.
- Write AS NICK, first person. Sign off "Nick".
- Absolutely no prices, no timeframes, no commitments about what the job needs.
- Ask for the ONE or TWO specific things he is missing to price it. If nothing is
  missing, say he will come back with a price.
- If you flagged this urgent, the draft says he will ring shortly and tells them
  to ring 111 if there is smoke or sparking. Do not ask a rusty-switchboard
  customer to answer questions by email.
- Plain text. It gets pasted into a text message or an email.

Reply as JSON only: {"summary": "...", "priority": "urgent|standard|info", "draftReply": "..."}`

  try {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), 8000)
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
      {
        method: 'POST',
        signal: ctl.signal,
        headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              ...photos.map((p) => ({ inline_data: { mime_type: p.type, data: p.b64 } })),
            ],
          }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 2048,
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'OBJECT',
              properties: {
                summary: { type: 'STRING' },
                priority: { type: 'STRING' },
                draftReply: { type: 'STRING' },
              },
              required: ['summary', 'priority', 'draftReply'],
            },
          },
        }),
      },
    )
    clearTimeout(timer)
    if (!r.ok) return null
    const data: any = await r.json()
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text
    if (!text) return null
    const parsed = JSON.parse(text)
    const priority = ['urgent', 'standard', 'info'].includes(parsed.priority) ? parsed.priority : 'standard'
    return {
      summary: String(parsed.summary).slice(0, 1500),
      priority,
      draftReply: parsed.draftReply ? String(parsed.draftReply).slice(0, 1200) : null,
    }
  } catch {
    return null
  }
}

function nzTime(iso: string): string {
  // The old WordPress install ran on UTC, so for two years every timestamp anyone
  // looked at was twelve hours out. Nick reads NZ time.
  try {
    return new Date(iso).toLocaleString('en-NZ', {
      timeZone: 'Pacific/Auckland',
      weekday: 'short', day: 'numeric', month: 'short',
      hour: 'numeric', minute: '2-digit', hour12: true,
    })
  } catch {
    return iso
  }
}

function buildEmail(
  e: Record<string, unknown>,
  ai: { summary: string; priority: string; draftReply: string | null } | null,
  id: string,
  createdAt: string,
) {
  const first = String(e.name ?? '').trim().split(/\s+/)[0] || null
  const urgent = ai?.priority === 'urgent'
  const who = first ? `${first}${e.suburb ? ` in ${e.suburb}` : ''}` : `someone${e.suburb ? ` in ${e.suburb}` : ''}`
  const jobLabel: Record<string, string> = {
    ev: 'EV charger', residential: 'home job', commercial: 'business job', other: 'general enquiry',
  }
  const job = jobLabel[String(e.jobType)] ?? 'enquiry'

  const subject = `${urgent ? '[URGENT] ' : ''}New enquiry — ${first ?? 'no name'}${e.suburb ? `, ${e.suburb}` : ''} — ${job}`
  const rule = '─'.repeat(52)
  const L: string[] = []

  L.push('Hi Nick,', '')
  L.push(urgent
    ? `${who} has been in touch about a ${job}, and it reads as urgent — worth ringing now.`
    : `You've got a new enquiry from ${who} — ${job}.`)

  if (urgent) L.push('', '⚡  URGENT — ring this one first')

  if (ai?.summary) L.push('', rule, ai.summary)

  L.push('', rule, 'HOW TO REACH THEM', '')
  if (e.phone) L.push(`  Phone    ${e.phone}${e.okToText ? '     (happy to be texted)' : '     (do not text)'}`)
  if (e.email) L.push(`  Email    ${e.email}`)
  if (e.suburb) L.push(`  Suburb   ${e.suburb}`)

  if (e.jobType === 'ev' && (e.evVehicle || e.evCharger || e.evDistance || e.evProperty)) {
    L.push('', rule, 'THE EV DETAILS THEY GAVE', '')
    if (e.evVehicle) L.push(`  Car          ${e.evVehicle}`)
    if (e.evCharger) L.push(`  Charger      ${e.evCharger}`)
    if (e.evDistance) L.push(`  Board → car  ${e.evDistance}`)
    if (e.evProperty) L.push(`  Property     ${e.evProperty}`)
  }

  if (e.message) L.push('', rule, 'IN THEIR OWN WORDS', '', `  "${String(e.message).trim()}"`)

  if (Number(e.photoCount) > 0) {
    L.push('', rule, `${e.photoCount} PHOTO${Number(e.photoCount) > 1 ? 'S' : ''} ATTACHED TO THIS EMAIL`)
  }

  if (ai?.draftReply) {
    L.push('', rule, 'A REPLY YOU COULD SEND', '',
      "  I've drafted this in your voice. Copy it, change whatever you like,",
      '  and send it from your own phone. Nothing reaches them unless you send it.', '',
      rule, '', ai.draftReply, '', rule)
  }

  // The draft block already closes with a rule; don't draw a second one.
  if (!ai?.draftReply) L.push('', rule)
  L.push('', '— Alice')
  L.push('I read the enquiries as they come in and write these up for you.')
  L.push("I'm software, so there's no need to reply to me — just get back to them.")
  if (!ai) {
    L.push('', '(My summarising step fell over on this one, so there is no write-up above.')
    L.push('Everything they actually sent is still here, though — nothing is missing.)')
  }
  L.push('', `Came in ${nzTime(createdAt)} via ${e.sourcePage ?? 'the website'}.  Ref ${id.slice(0, 8).toUpperCase()}`)

  return { subject, body: L.join('\n') }
}

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  const { request, env } = ctx

  let payload: Record<string, unknown>
  try {
    payload = await request.json()
  } catch {
    return json({ ok: false, error: 'Could not read that submission.' }, 400)
  }

  // Photos: capped hard. Anything beyond this is a mistake or an attack, and the
  // client already resizes before upload.
  const MAX_PHOTOS = 4
  const MAX_PHOTO_B64 = 3_000_000 // ~2.2MB decoded, each
  const photos: Photo[] = Array.isArray(payload.photos)
    ? (payload.photos as any[])
        .slice(0, MAX_PHOTOS)
        .filter((p) => p && typeof p.b64 === 'string' && /^image\/(jpeg|png|webp)$/.test(p.type || '') && p.b64.length <= MAX_PHOTO_B64)
        .map((p, i) => ({ name: String(p.name || `photo-${i + 1}.jpg`).slice(0, 80), type: p.type, b64: p.b64 }))
    : []

  // Honeypot — a real person never fills this in.
  if (clean(payload.company, 'name')) return json({ ok: true, id: 'ignored' })

  const e: Record<string, unknown> = {
    name: clean(payload.name, 'name'),
    phone: clean(payload.phone, 'phone'),
    email: clean(payload.email, 'email'),
    suburb: clean(payload.suburb, 'suburb'),
    jobType: clean(payload.jobType, 'jobType'),
    message: clean(payload.message, 'message'),
    evVehicle: clean(payload.evVehicle, 'evVehicle'),
    evCharger: clean(payload.evCharger, 'evCharger'),
    evDistance: clean(payload.evDistance, 'evDistance'),
    evProperty: clean(payload.evProperty, 'evProperty'),
    sourcePage: clean(payload.sourcePage, 'sourcePage'),
    okToText: payload.okToText === 'yes' || payload.okToText === true ? 1 : 0,
    photoCount: photos.length,
  }

  // A way to contact him back is the only genuinely required field.
  if (!e.phone && !e.email) {
    return json({ ok: false, error: 'Please leave a phone number or an email so Nick can get back to you.' }, 400)
  }

  const id = crypto.randomUUID()
  const now = new Date().toISOString()

  // ---- STEP 2: durable write. If this fails, the customer is told to ring. ----
  try {
    await env.DB.prepare(
      `INSERT INTO enquiries (id, created_at, name, phone, email, suburb, job_type, message,
        photo_count, ev_vehicle, ev_charger, ev_distance, ev_property, user_agent, source_page, ok_to_text)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
      .bind(
        id, now, e.name, e.phone, e.email, e.suburb, e.jobType, e.message,
        e.photoCount, e.evVehicle, e.evCharger, e.evDistance, e.evProperty,
        request.headers.get('user-agent')?.slice(0, 300) ?? null, e.sourcePage, e.okToText,
      )
      .run()
  } catch {
    return json(
      { ok: false, error: `Sorry — something went wrong saving that. Please ring Nick on 0210 918 6333.` },
      500,
    )
  }

  // ---- STEPS 3 & 4: deferred. Nothing the model writes reaches the customer, so
  // there is no reason to make them wait for it. The briefing goes to Nick's phone,
  // where he is the registered expert who can judge it. The confirmation screen
  // shows the customer their own answers instead. Form is ~8s faster as a side
  // effect of being safer.
  ctx.waitUntil(
    (async () => {
      const ai = await triage(env, e, photos)
      try {
        await env.DB.prepare(
          `UPDATE enquiries SET ai_summary=?, ai_priority=?, ai_draft=?, ai_status=? WHERE id=?`,
        ).bind(
          ai?.summary ?? null,
          ai?.priority ?? null,
          ai?.draftReply ?? null,
          ai ? 'ok' : (env.GEMINI_API_KEY ? 'failed' : 'skipped'),
          id,
        ).run()
      } catch { /* the enquiry is already safe */ }

      const { subject, body } = buildEmail(e, ai, id, now)
      let outcome: 'sent' | 'failed' | 'skipped' = 'skipped'

      // Primary: the rde-notify Worker, which delivers via Cloudflare Email
      // Routing. No third-party mail vendor involved.
      if (env.NOTIFY_URL && env.NOTIFY_SECRET) {
        try {
          const r = await fetch(env.NOTIFY_URL, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-notify-secret': env.NOTIFY_SECRET,
            },
            body: JSON.stringify({
              subject,
              text: body,
              replyTo: (e.email as string) || undefined,
              attachments: photos.map((p) => ({ filename: p.name, contentType: p.type, base64: p.b64 })),
            }),
          })
          outcome = r.ok ? 'sent' : 'failed'
        } catch {
          outcome = 'failed'
        }
      }

      // Fallback: Resend, if it is ever configured and the relay did not deliver.
      if (outcome !== 'sent' && env.RESEND_API_KEY) {
        try {
          const r = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              authorization: `Bearer ${env.RESEND_API_KEY}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              from: `Red Dragon Electrix <${NOTIFY_FROM}>`,
              to: [NOTIFY_TO],
              reply_to: (e.email as string) || undefined,
              subject,
              text: body,
            }),
          })
          outcome = r.ok ? 'sent' : 'failed'
        } catch {
          outcome = 'failed'
        }
      }

      try {
        await env.DB.prepare(
          `UPDATE enquiries SET notify_status=?, notified_at=? WHERE id=?`,
        ).bind(outcome, outcome === 'sent' ? new Date().toISOString() : null, id).run()
      } catch { /* the enquiry is already safe */ }
    })(),
  )

  // Deliberately returns no model output. See the comment on steps 3 & 4.
  return json({ ok: true, id })
}

/** Health endpoint. A monitor hits this; zero enquiries in 30 days is the alarm. */
export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  try {
    const row = await env.DB.prepare(`SELECT * FROM enquiry_health`).first<any>()
    const last = row?.last_enquiry_at ? new Date(row.last_enquiry_at) : null
    const days = last ? Math.floor((Date.now() - last.getTime()) / 86_400_000) : null
    return json({
      ok: true,
      total: row?.total ?? 0,
      lastEnquiryAt: row?.last_enquiry_at ?? null,
      daysSinceLastEnquiry: days,
      failedNotifications: row?.failed_notifications ?? 0,
    })
  } catch {
    return json({ ok: false }, 500)
  }
}
