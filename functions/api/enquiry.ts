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

/** Ask the model for a briefing. Returns null on any failure — never throws. */
async function triage(env: Env, e: Record<string, unknown>): Promise<{ summary: string; priority: string } | null> {
  if (!env.GEMINI_API_KEY) return null

  const prompt = `You are triaging a job enquiry for a New Zealand electrician (Red Dragon Electrix, Auckland).

Write a briefing for the electrician. He reads it on his phone between jobs.

RULES — these are absolute:
- NEVER estimate, suggest or imply a price. You do not know his rates.
- NEVER state whether the job is easy, hard, or how long it will take.
- NEVER address the customer. You are writing to the electrician only.
- If the enquiry is vague, say what he should ask, do not guess the answer.
- Plain New Zealand English. No marketing language. Short.

Assign a priority:
  urgent   — a described safety issue: burning smell, sparking, smoke, shock, no power
  standard — a real job enquiry
  info     — a question, a sales approach, spam, or nothing actionable

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

Reply as JSON only: {"summary": "...", "priority": "urgent|standard|info"}`

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
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 2048,
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'OBJECT',
              properties: { summary: { type: 'STRING' }, priority: { type: 'STRING' } },
              required: ['summary', 'priority'],
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
    return { summary: String(parsed.summary).slice(0, 1500), priority }
  } catch {
    return null
  }
}

function buildEmail(e: Record<string, unknown>, ai: { summary: string; priority: string } | null, id: string) {
  const flag = ai?.priority === 'urgent' ? '[URGENT] ' : ''
  const subject = `${flag}Website enquiry — ${e.jobType ?? 'general'} — ${e.name ?? 'no name'}`
  const lines = [
    ai ? `BRIEFING (${ai.priority})` : 'BRIEFING — unavailable, raw enquiry follows',
    ai ? ai.summary : '(the summarising step failed; nothing is missing below)',
    '',
    '---',
    `Name:    ${e.name ?? '-'}`,
    `Phone:   ${e.phone ?? '-'}`,
    `Email:   ${e.email ?? '-'}`,
    `Suburb:  ${e.suburb ?? '-'}`,
    `Job:     ${e.jobType ?? '-'}`,
  ]
  if (e.jobType === 'ev') {
    lines.push(
      `Vehicle: ${e.evVehicle ?? '-'}`,
      `Charger: ${e.evCharger ?? '-'}`,
      `Distance board -> parking: ${e.evDistance ?? '-'}`,
      `Property: ${e.evProperty ?? '-'}`,
    )
  }
  lines.push('', 'Message:', String(e.message ?? '-'), '', `Ref: ${id}`)
  return { subject, body: lines.join('\n') }
}

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  const { request, env } = ctx

  let payload: Record<string, unknown>
  try {
    payload = await request.json()
  } catch {
    return json({ ok: false, error: 'Could not read that submission.' }, 400)
  }

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
    photoCount: Number.isFinite(payload.photoCount) ? Math.min(Number(payload.photoCount), 20) : 0,
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
        photo_count, ev_vehicle, ev_charger, ev_distance, ev_property, user_agent, source_page)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
      .bind(
        id, now, e.name, e.phone, e.email, e.suburb, e.jobType, e.message,
        e.photoCount, e.evVehicle, e.evCharger, e.evDistance, e.evProperty,
        request.headers.get('user-agent')?.slice(0, 300) ?? null, e.sourcePage,
      )
      .run()
  } catch {
    return json(
      { ok: false, error: `Sorry — something went wrong saving that. Please ring Nick on 0210 918 6333.` },
      500,
    )
  }

  // ---- STEPS 3 & 4: best effort, after the response is already guaranteed. ----
  ctx.waitUntil(
    (async () => {
      const ai = await triage(env, e)
      try {
        await env.DB.prepare(
          `UPDATE enquiries SET ai_summary=?, ai_priority=?, ai_status=? WHERE id=?`,
        ).bind(ai?.summary ?? null, ai?.priority ?? null, ai ? 'ok' : (env.GEMINI_API_KEY ? 'failed' : 'skipped'), id).run()
      } catch { /* the enquiry is already safe */ }

      const { subject, body } = buildEmail(e, ai, id)
      let outcome: 'sent' | 'failed' | 'skipped' = 'skipped'
      if (env.RESEND_API_KEY) {
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
