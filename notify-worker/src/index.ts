/**
 * Enquiry notification relay.
 *
 * Exists solely because Cloudflare Pages Functions cannot carry a [[send_email]]
 * binding while Workers can. The site's /api/enquiry Function posts here and this
 * delivers through Cloudflare Email Routing — no third-party mail vendor, no
 * extra account, no extra API key.
 *
 * Guarded by a shared secret so it cannot be used as an open relay.
 */

interface Env {
  NOTIFY: { send(msg: unknown): Promise<void> }
  NOTIFY_SECRET: string
}

const TO = 'dragonelectrix@gmail.com'
const FROM = 'enquiries@reddragonelectrix.co.nz'

/** RFC 5322 headers must be ASCII; enquiries routinely contain macrons and en dashes. */
function encodeHeader(s: string): string {
  if (/^[\x00-\x7F]*$/.test(s)) return s
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  bytes.forEach((b) => (bin += String.fromCharCode(b)))
  return `=?UTF-8?B?${btoa(bin)}?=`
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

    const subject = (body.subject || 'Website enquiry').slice(0, 200)
    const text = (body.text || '').slice(0, 20_000)

    try {
      const { EmailMessage } = await import('cloudflare:email')
      const headers = [
        `From: Red Dragon Electrix <${FROM}>`,
        `To: <${TO}>`,
        `Subject: ${encodeHeader(subject)}`,
        body.replyTo ? `Reply-To: <${body.replyTo}>` : null,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=utf-8',
      ]
        .filter(Boolean)
        .join('\r\n')

      await env.NOTIFY.send(new EmailMessage(FROM, TO, `${headers}\r\n\r\n${text}`))
      return Response.json({ ok: true })
    } catch (err) {
      return Response.json({ ok: false, error: String(err).slice(0, 300) }, { status: 502 })
    }
  },
}
