import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'HAPI',
  description: 'Control your AI agents from anywhere',
  base: '/docs/',

  head: [
    ['link', { rel: 'icon', href: '/docs/favicon.ico' }],
  ],

  themeConfig: {
    logo: '/logo.svg',

    nav: [
      { text: 'Quick Start', link: '/guide/quick-start' },
      { text: 'App', link: 'https://app.hapi.run', target: '_blank' }
    ],

    sidebar: [
      { text: 'Quick Start', link: '/guide/quick-start' },
      { text: 'Installation', link: '/guide/installation' },
      { text: 'Public / Tunnel Deployment', link: '/guide/tunnel-deployment' },
      { text: 'VPS Relay Deployment', link: '/guide/vps-relay-deployment' },
      { text: 'PWA', link: '/guide/pwa' },
      { text: 'How it Works', link: '/guide/how-it-works' },
      { text: 'Codex App-Server', link: '/guide/codex-native-app-server' },
      { text: 'Codex Feature Gap', link: '/guide/codex-app-server-feature-gap' },
      { text: 'Cursor Agent', link: '/guide/cursor' },
      { text: 'Voice Assistant', link: '/guide/voice-assistant' },
      { text: 'Why HAPI', link: '/guide/why-hapi' },
      { text: 'FAQ', link: '/guide/faq' }
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/tiann/hapi' }
    ],

    footer: {
      message: 'Released under the LGPL-3.0 License.',
      copyright: 'Copyright © 2024-present'
    },

    search: {
      provider: 'local'
    }
  },

  vite: {
    server: {
      allowedHosts: true
    }
  }
})
