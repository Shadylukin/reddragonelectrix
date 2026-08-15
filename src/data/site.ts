/**
 * Single source of truth for business facts.
 *
 * Everything here was verified against the old site's database during the August 2026
 * rebuild. Anything NOT verified is marked TODO and must be confirmed with Nick before
 * it goes live — do not invent values for these.
 */

export const site = {
  name: 'Red Dragon Electrix',
  legalName: 'Red Dragon Electrix Limited',

  // POSITIONING, Aug 2026, revised twice.
  //
  // The old site led with "West Auckland's Most Reputable Electricians". Enquiry data
  // from 2023-24 said that was wrong on both counts: 77 of 96 enquiries (80%) were EV /
  // Tesla charger installs, and roughly half came from outside West Auckland.
  //
  // So it briefly led with EV only. Then Nick confirmed the 80% was driven by TESLA'S
  // INSTALLER REFERRAL LIST, which he has since come off. Without that funnel, traffic
  // shifts toward general search and the Google listing — and "EV Charger Specialists"
  // as the sole identity risks losing the homeowner whose switchboard is buzzing.
  //
  // Final position: registered Auckland electrician WHO SPECIALISES in EV. Both. The EV
  // page stays strong; it is the differentiator and it is evidence for his Tesla
  // reapplication.
  tagline: 'Need a sparky in Auckland?',
  taglineAccent: 'Ring Nick.',
  taglineSecondary:
    "Registered electrician, Glen Eden. Switchboards, rewires and lighting — and Auckland's EV charger specialist.",
  description:
    'Manufacturer-trained EV charger installation across Auckland, including Tesla wall connectors. Plus switchboards, rewires, lighting and power points for homes and businesses.',
  url: 'https://reddragonelectrix.co.nz',
  locale: 'en-NZ',

  phone: {
    display: '0210 918 6333',
    href: 'tel:+642109186333',
    e164: '+642109186333',
  },

  // The public address. Cloudflare Email Routing forwards nick@ (and a catch-all for
  // anything else at the domain) to the Gmail below. Verified: MX live, rule enabled,
  // destination confirmed 2026-08-15.
  //
  // Until today the domain had no MX records at all, so this address had been bouncing
  // silently since the old host pulled the site — which is why the old contact form
  // delivered to a Gmail instead.
  email: 'nick@reddragonelectrix.co.nz',

  // Where mail actually lands. Internal only — never shown on the site. Notification
  // delivery is hardcoded to this in functions/api/enquiry.ts and the notify Worker,
  // because it is the verified Email Routing destination.
  emailDelivery: 'dragonelectrix@gmail.com',

  facebook: 'https://www.facebook.com/reddragonelectrix',

  address: {
    locality: 'Glen Eden',
    region: 'Auckland',
    country: 'NZ',
    // Old site said "Matama Road, Glen Eden" with no street number.
    street: null as string | null, // TODO: confirm with Nick, or omit entirely
  },

  // The old site never named a single suburb anywhere — verified across the whole database.
  // This list is derived from where enquiries ACTUALLY came from (96 enquiries, 2023-2024),
  // not from guesswork. Note how far beyond West Auckland it reaches.
  areaServed: ['Auckland', 'West Auckland', 'North Shore', 'Central Auckland'],
  suburbs: [
    // West
    'Glen Eden', 'Titirangi', 'Henderson', 'Te Atatū', 'Swanson', 'Ranui', 'Avondale',
    'Blockhouse Bay', 'New Lynn', 'Massey',
    // Northwest / North
    'Hobsonville', 'Westgate', 'Northcote',
    // Central / East
    'Mt Albert', 'Grey Lynn', 'Epsom', 'Remuera', 'Parnell',
  ] as string[],

  // Confirmed: 7am-7pm, seven days.
  openingHours: 'Mo-Su 07:00-19:00' as string | null,
  openingHoursDisplay: '7am – 7pm, 7 days',

  // Confirmed by Nick: EWRB registered electrician, E269419.
  // The compliance section invites people to verify this on ewrb.govt.nz, so it
  // must be his real number — an invitation that resolves to nothing is worse
  // than no invitation.
  ewrbRegistration: 'E269419' as string | null,
  ewrbClass: 'Electrician',

  // TODO: still unknown — asked. Cover amount only, never the policy number.
  insured: null as boolean | null,
  insuranceCover: null as string | null,

  rating: {
    value: 5,
    best: 5,
    count: 9, // verified: wphx_glsr_ratings, 9 rows, all rated 5
  },
} as const

/**
 * Order matters — this drives nav order and homepage hierarchy.
 * EV chargers lead because 80% of measured demand was EV, not because it reads well.
 */
export const services = [
  {
    slug: 'ev-chargers',
    title: 'EV Charger Installation',
    navLabel: 'EV Chargers',
    flagship: true,
    blurb: 'Manufacturer-trained EV charger specialists, all across Auckland.',
    description:
      'Manufacturer-trained EV charger installation for homes and businesses across Auckland, including Tesla wall connectors and Gen 3 units.',
    image: '/img/ev-charger.jpg',
    imageAlt: 'An EV charger installed on a garage wall',
    items: [
      'Tesla Wall Connector & Gen 3 installation',
      'Home EV charger installation',
      'Commercial & workplace charging',
      'Switchboard capacity assessment',
      'Dedicated circuit installation',
      'Apartment, terrace & body corporate installs',
      'Load management & future-proofing',
    ],
  },
  {
    slug: 'residential',
    title: 'Residential Electricians',
    navLabel: 'Residential',
    blurb: 'Reliable, on-time electricians for homes.',
    description:
      'Maintenance, rewires, lighting and switchboard upgrades for Auckland homes, done tidily and on time.',
    image: '/img/residential.jpg',
    items: [
      'Switchboard installation & upgrades',
      'VIR identification & rewiring',
      'LED lighting upgrades',
      'Power outlets & USB power outlets',
      'Bathroom lighting & ventilation',
      'Oven & kitchen appliance installation',
      'Heated towel rail installation',
      'Residential maintenance',
    ],
  },
  {
    slug: 'commercial',
    title: 'Commercial Electricians',
    navLabel: 'Commercial',
    blurb: 'Reliable, quality and expert commercial electricians.',
    description:
      'Fit-outs, lighting and new build electrical for Auckland businesses, from single sites to full commercial projects.',
    image: '/img/commercial.jpg',
    items: [
      'Commercial fit-outs',
      'Business lighting installation',
      'New build electrical',
      'Ethernet & data connections',
      'Switchboard installation & upgrades',
      'Maintenance & fault finding',
    ],
  },
] as const

/**
 * The job log. Captions describe only what is visibly in each photograph —
 * no invented suburbs, no invented client names. `suburb` is null until Nick
 * confirms where each job actually was; the caption degrades gracefully.
 *
 * The panel's point stands: captioning is the cheapest upgrade there is from
 * "photo grid" to "portfolio". But a made-up suburb is a lie on a real
 * business's website, so these stay null until he tells us.
 */
export const jobLog = [
  { img: '/img/ev-charger.jpg',      job: 'EV charger installation',   prop: 'Home garage',        suburb: null as string | null },
  { img: '/img/interior.jpg',        job: 'Interior lighting',         prop: 'Residential',        suburb: null as string | null },
  { img: '/img/commercial.jpg',      job: 'Commercial lighting',       prop: 'Retail fit-out',     suburb: null as string | null },
  { img: '/img/outdoor-lighting.jpg', job: 'Exterior lighting',        prop: 'Residential',        suburb: null as string | null },
  { img: '/img/oven.jpg',            job: 'Oven & rangehood install',  prop: 'Kitchen',            suburb: null as string | null },
  { img: '/img/commercial-med.jpg',  job: 'Commercial electrical',     prop: 'Medical facility',   suburb: null as string | null },
] as const

/**
 * Install spec for the EV paper card.
 *
 * Deliberately describes NICK'S INSTALL, not Tesla's product specification.
 * Publishing manufacturer figures we cannot verify would put wrong numbers on
 * a real electrician's website; what he does on site is his own to state.
 */
export const evInstallSpec = [
  { term: 'Supply',        value: 'Single or 3-phase' },
  { term: 'Circuit',       value: 'Dedicated, RCD protected' },
  { term: 'Cable run',     value: 'Measured on site' },
  { term: 'Certification', value: 'CoC issued' },
  // TODO: Nick to confirm a standard install price. Until then this stays as a
  // qualitative answer — an invented figure is worse than no figure.
  { term: 'Typical install', value: 'Quoted from photos' },
] as const

/** Real reviews, verified 5-star in the old site's database. Do not edit the wording. */
export const reviews = [
  {
    author: 'Prashant Champa',
    rating: 5,
    body: 'Great job installing our Tesla wall connector. Nick was great, very professional. Highly recommended!',
  },
  {
    author: 'Gail Blackwell',
    rating: 5,
    body: 'Great communicator, turned up on time and did a great job and left premises clean and tidy. Installed outside power points, heater and replaced two bathroom lights.',
  },
  {
    author: 'Ben Berry',
    rating: 5,
    body: 'Did a great job upgrading our switchboard, swapping out all of our lights and replacing a lot of the power points.',
  },
  {
    author: 'Michelle Swanepoel',
    rating: 5,
    body: 'Very happy with the service done by Nick! Easy to deal with and done to a great standard. Highly recommend.',
  },
  {
    author: 'Nimfa Rey Uy',
    rating: 5,
    body: 'Responsive, creative & reliable when he did our EV charging station. Highly recommended.',
  },
  {
    author: 'Lynn McNeill',
    rating: 5,
    body: 'Amazing job — on time, met my brief and did a great job for a great price. Outside garden lighting.',
  },
] as const
