/**
 * Two jobs in one Worker.
 *
 * 1. NOTIFICATION RELAY (fetch). Cloudflare Pages Functions cannot carry a
 *    [[send_email]] binding; Workers can. The site's /api/enquiry posts here and
 *    this delivers through Cloudflare Email Routing — no third-party mail vendor.
 *    Customer photos arrive as base64 and are attached to the message. They are
 *    never written to storage: a photograph of the inside of someone's house is
 *    the most sensitive thing this site handles, and the safest place for it is
 *    Nick's inbox rather than a bucket somebody has to secure, retain and
 *    eventually breach.
 *
 * 2. WATCHDOG (scheduled, every 6h). Posts a REAL enquiry end to end, confirms the
 *    row lands, confirms notify_status flips to 'sent', then deletes it. Alerts if
 *    any leg is broken, or if no genuine enquiry has arrived in 21 days.
 *
 *    This exists because of April 2024. A health endpoint that returns 200 while
 *    the form is broken is what already existed. Only a real transaction, watched
 *    from outside, catches that class of failure.
 */

interface Env {
  NOTIFY: { send(msg: unknown): Promise<void> }
  NOTIFY_SECRET: string
  DB: D1Database
}

interface Attachment {
  filename: string
  contentType: string
  base64: string
}

const TO = 'dragonelectrix@gmail.com'
const FROM = 'enquiries@reddragonelectrix.co.nz'
const SITE = 'https://reddragonelectrix.co.nz'
const WATCHDOG_NAME = '__watchdog__'
const QUIET_DAYS = 21
const MAX_ATTACH = 4
const MAX_TOTAL_BYTES = 12 * 1024 * 1024

function encodeHeader(s: string): string {
  if (/^[\x00-\x7F]*$/.test(s)) return s
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  bytes.forEach((b) => (bin += String.fromCharCode(b)))
  return `=?UTF-8?B?${btoa(bin)}?=`
}

/** base64 must be wrapped at 76 chars for RFC 2045 compliance. */
function wrap76(s: string): string {
  return (s.match(/.{1,76}/g) ?? []).join('\r\n')
}

function safeFilename(name: string, i: number): string {
  const clean = name.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 60)
  return /\.(jpe?g|png|webp|heic)$/i.test(clean) ? clean : `photo-${i + 1}.jpg`
}

async function sendMail(
  env: Env,
  subject: string,
  text: string,
  replyTo?: string,
  attachments: Attachment[] = [],
) {
  const { EmailMessage } = await import('cloudflare:email')

  const base = [
    `From: Red Dragon Electrix <${FROM}>`,
    `To: <${TO}>`,
    `Subject: ${encodeHeader(subject)}`,
    replyTo ? `Reply-To: <${replyTo}>` : null,
    'MIME-Version: 1.0',
  ].filter(Boolean)

  let raw: string
  if (!attachments.length) {
    raw = [...base, 'Content-Type: text/plain; charset=utf-8', '', text].join('\r\n')
  } else {
    const b = `----rde-${crypto.randomUUID()}`
    const parts: string[] = [
      ...base,
      `Content-Type: multipart/mixed; boundary="${b}"`,
      '',
      `--${b}`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      text,
    ]
    attachments.forEach((a, i) => {
      parts.push(
        `--${b}`,
        `Content-Type: ${a.contentType}; name="${safeFilename(a.filename, i)}"`,
        'Content-Transfer-Encoding: base64',
        `Content-Disposition: attachment; filename="${safeFilename(a.filename, i)}"`,
        '',
        wrap76(a.base64),
      )
    })
    parts.push(`--${b}--`, '')
    raw = parts.join('\r\n')
  }

  await env.NOTIFY.send(new EmailMessage(FROM, TO, raw))
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') return new Response('method not allowed', { status: 405 })
    if (!env.NOTIFY_SECRET || request.headers.get('x-notify-secret') !== env.NOTIFY_SECRET) {
      return new Response('forbidden', { status: 403 })
    }

    let body: { subject?: string; text?: string; replyTo?: string; attachments?: Attachment[] }
    try {
      body = await request.json()
    } catch {
      return new Response('bad request', { status: 400 })
    }

    // Cap attachments defensively — the caller already validates, but this Worker
    // is reachable independently and must not be turned into a mail bomb.
    let total = 0
    const attachments = (body.attachments ?? [])
      .slice(0, MAX_ATTACH)
      .filter((a) => {
        if (!a?.base64 || !/^image\//.test(a.contentType || '')) return false
        total += a.base64.length
        return total <= MAX_TOTAL_BYTES
      })

    try {
      await sendMail(
        env,
        (body.subject || 'Website enquiry').slice(0, 200),
        (body.text || '').slice(0, 20_000),
        body.replyTo,
        attachments,
      )
      return Response.json({ ok: true, attached: attachments.length })
    } catch (err) {
      return Response.json({ ok: false, error: String(err).slice(0, 300) }, { status: 502 })
    }
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      (async () => {
        const problems: string[] = []
        let id: string | null = null

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

        if (id) {
          await new Promise((res) => setTimeout(res, 15_000))
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
