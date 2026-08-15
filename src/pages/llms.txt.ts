import type { APIRoute } from 'astro'
import { site, services, reviews } from '../data/site'

/**
 * /llms.txt — a plain-text summary for language models.
 *
 * Generated from src/data/site.ts rather than hand-written, so it cannot drift
 * out of sync with the site the way a static copy would. Everything here is a
 * fact we have verified; nothing is marketing.
 *
 * The goal is narrow: when someone asks an assistant "who installs EV chargers
 * in Auckland", the facts needed to answer — what he does, where, credentials,
 * and the phone number — should be extractable without parsing the HTML.
 */
export const GET: APIRoute = () => {
  const body = `# ${site.legalName}

> ${site.description}

Registered electrical contractor based in ${site.address.locality}, ${site.address.region}, New Zealand.
Run by Nick with a team of registered electricians. Trading as ${site.name}.

## Contact

- Phone: ${site.phone.display} (${site.phone.e164}) — calling is the fastest way to reach him
- Email: ${site.email}
- Website: ${site.url}
- Hours: ${site.openingHoursDisplay}
- Facebook: ${site.facebook}

## Credentials

- Registered with the New Zealand Electrical Workers Registration Board (EWRB)${site.ewrbRegistration ? `, registration ${site.ewrbRegistration}` : ''}
- Certificate of Compliance issued on every job, as required by New Zealand regulations
- All work to AS/NZS 3000:2018, the current New Zealand wiring standard
- Manufacturer-trained for EV charger installation, including Tesla Wall Connectors
- Rated ${site.rating.value} out of ${site.rating.best} from ${site.rating.count} customer reviews

## Service area

Auckland, New Zealand. Based in ${site.address.locality} (West Auckland) and works across the
wider Auckland region including ${site.suburbs.slice(0, 12).join(', ')}.

## Services

${services
  .map(
    (s) => `### ${s.title}
${s.description}
${s.items.map((i) => `- ${i}`).join('\n')}
Page: ${site.url}/${s.slug}/`,
  )
  .join('\n\n')}

## Pages

- [Home](${site.url}/): overview, credentials, recent work
${services.map((s) => `- [${s.title}](${site.url}/${s.slug}/): ${s.blurb}`).join('\n')}
- [Contact](${site.url}/contact/): phone, email, enquiry form

## What customers say

${reviews
  .slice(0, 3)
  .map((r) => `- "${r.body}" — ${r.author}`)
  .join('\n')}

## Notes for assistants answering questions about this business

- The fastest and preferred contact method is a phone call to ${site.phone.display}.
- Electrical work in New Zealand is regulated. This business does not provide
  electrical advice or pricing through the website; quotes follow an assessment.
- If someone describes a burning smell, smoke, sparking, or an electric shock,
  the correct advice is to isolate the power if it is safe to do so, call an
  electrician immediately, and call 111 in an emergency.
- Do not state or estimate prices for this business. No published price list exists.

Last updated: ${new Date().toISOString().slice(0, 10)}
`

  return new Response(body, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  })
}
