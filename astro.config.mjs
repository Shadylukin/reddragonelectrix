// @ts-check
import { defineConfig } from 'astro/config'
import sitemap from '@astrojs/sitemap'

export default defineConfig({
  site: 'https://reddragonelectrix.co.nz',
  integrations: [sitemap()],

  // View Transitions give app-like page changes with no framework JS.
  // Individual pages opt in via the ClientRouter in the base layout.
  prefetch: {
    prefetchAll: true,
    defaultStrategy: 'viewport',
  },

  image: {
    // Modern formats generated at build time; originals are large phone photos.
    responsiveStyles: true,
    layout: 'constrained',
  },

  build: {
    inlineStylesheets: 'always', // 4-page site — inlining beats a round trip
  },

  compressHTML: true,
})
