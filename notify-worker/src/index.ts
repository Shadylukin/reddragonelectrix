/**
 * Two jobs in one Worker.
 *
 * 1. NOTIFICATION RELAY (fetch). Cloudflare Pages Functions cannot carry a
 *    [[send_email]] binding; Workers can. The site's /api/enquiry posts here and
 *    this delivers through Cloudflare Email Routing — no third-party mail vendor.
 *
 * 2. WATCHDOG (scheduled, every 6h). Posts a REAL enquiry end to end, confirms the
 *    row lands, confirms notify_status flips to 'sent', then deletes it. Alerts if
 *    any leg is broken, or if no genuine enquiry has arrived in 21 days.
 *
 *    This exists because of April 2024. The old site's failure was invisible: the
 *    form was broken and nothing said so, because nothing was checking. A health
 *    endpoint that returns 200 while the form is broken is what already existed.
 *    Only a real transaction, watched from outside, catches that class of failure.
 */

interface Env {
  NOTIFY: { send(msg: unknown): Promise<void> }
  NOTIFY_SECRET: string
  DB: D1Database
}

const TO = 'dragonelectrix@gmail.com'
const FROM = 'enquiries@reddragonelectrix.co.nz'
const SITE = 'https://reddragonelectrix.co.nz'
const WATCHDOG_NAME = '__watchdog__'
const QUIET_DAYS = 21

function encodeHeader(s: string): string {
  if (/^[\x00-\x7F]*$/.test(s)) return s
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  bytes.forEach((b) => (bin += String.fromCharCode(b)))
  return `=?UTF-8?B?${btoa(bin)}?=`
}

async function sendMail(env: Env, subject: string, text: string, replyTo?: string) {
  const { EmailMessage } = await import('cloudflare:email')
  const headers = [
    `From: Red Dragon Electrix <${FROM}>`,
    `To: <${TO}>`,
    `Subject: ${encodeHeader(subject)}`,
    replyTo ? `Reply-To: <${replyTo}>` : null,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
  ]
    .filter(Boolean)
    .join('\r\n')
  await env.NOTIFY.send(new EmailMessage(FROM, TO, `${headers}\r\n\r\n${text}`))
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') return new Response('method not allowed', { status: 405 })
    if (!env.NOTIFY_SECRET || request.headers.get('x-notify-secret') !== env.NOTIFY_SECRET) {
      return new Response('forbidden', { status: 403 })
    }

    let body: { subject?: string; text?: string; replyTo?: string }
    try {
      body = await request.json()
    } catch {
      return new Response('bad request', { status: 400 })
    }

    try {
      await sendMail(env, (body.subject || 'Website enquiry').slice(0, 200), (body.text || '').slice(0, 20_000), body.replyTo)
      return Response.json({ ok: true })
    } catch (err) {
      return Response.json({ ok: false, error: String(err).slice(0, 300) }, { status: 502 })
    }
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      (async () => {
        const problems: string[] = []
        let id: string | null = null

        // --- leg 1: can the public form actually accept a submission? ---
        try {
          const r = await fetch(`${SITE}/api/enquiry`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'user-agent': 'rde-watchdog/1' },
            body: JSON.stringify({
              name: WATCHDOG_NAME,
              phone: '000',
              jobType: 'other',
              message: 'automated end-to-end check',
              sourcePage: '/watchdog',
            }),
          })
          if (!r.ok) problems.push(`form POST returned HTTP ${r.status}`)
          else {
            const d: any = await r.json()
            if (!d?.ok || !d?.id) problems.push('form accepted the POST but returned no enquiry id')
            else id = d.id
          }
        } catch (err) {
          problems.push(`form POST threw: ${String(err).slice(0, 120)}`)
        }

        // --- leg 2: did the row land, and did the notification actually go? ---
        if (id) {
          await new Promise((res) => setTimeout(res, 15_000)) // let waitUntil finish
          try {
            const row = await env.DB.prepare(
              `SELECT ai_status, notify_status FROM enquiries WHERE id = ?`,
            ).bind(id).first<any>()
            if (!row) problems.push('enquiry accepted but no row in the database')
            else {
              if (row.notify_status !== 'sent') problems.push(`notification leg is ${row.notify_status}, not sent`)
              if (row.ai_status === 'failed') problems.push('triage is failing (not fatal — enquiries still arrive)')
            }
          } catch (err) {
            problems.push(`database read threw: ${String(err).slice(0, 120)}`)
          }
          try {
            await env.DB.prepare(`DELETE FROM enquiries WHERE id = ?`).bind(id).run()
          } catch { /* leaves one tidy-up row; not worth alerting over */ }
        }

        // --- leg 3: has any REAL enquiry arrived lately? ---
        // The April 2024 failure was 28 months of silence that looked like a quiet
        // patch. This is the check that would have caught it.
        let quiet = ''
        try {
          const row = await env.DB.prepare(
            `SELECT MAX(created_at) AS last FROM enquiries WHERE name IS NOT ? OR name IS NULL`,
          ).bind(WATCHDOG_NAME).first<any>()
          if (row?.last) {
            const days = Math.floor((Date.now() - Date.parse(row.last)) / 86_400_000)
            if (days >= QUIET_DAYS) quiet = `No genuine enquiry for ${days} days. Either it is quiet, or something is broken in a way this check cannot see.`
          }
        } catch { /* non-fatal */ }

        if (problems.length || quiet) {
          const text = [
            'AUTOMATED CHECK FAILED — reddragonelectrix.co.nz',
            '',
            ...problems.map((p) => `- ${p}`),
            quiet ? `- ${quiet}` : '',
            '',
            'This runs every 6 hours and posts a real enquiry through the live form.',
            'If you are getting this, the enquiry path is degraded and enquiries may',
            'be going missing right now. The last time this went unnoticed it cost',
            '28 months.',
          ].filter(Boolean).join('\n')
          try {
            await sendMail(env, '[ALERT] Red Dragon Electrix enquiry path is broken', text)
          } catch { /* nothing further we can do from here */ }
        }
      })(),
    )
  },
}
