import type { MetadataRoute } from 'next';
import { HERMES_THEME_COLORS } from '@/lib/theme-colors';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'HermesDeck',
    short_name: 'HermesDeck',
    description: 'Hermes-native mobile console with multi-session chat and Agent switching.',
    id: '/',
    start_url: '/chat?source=pwa',
    scope: '/',
    display: 'standalone',
    display_override: ['window-controls-overlay', 'standalone', 'browser'],
    orientation: 'any',
    background_color: HERMES_THEME_COLORS.light,
    theme_color: HERMES_THEME_COLORS.light,
    categories: ['productivity', 'developer', 'utilities'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
    shortcuts: [
      { name: 'New chat', short_name: 'Chat', url: '/chat?source=shortcut', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
      { name: 'Live Terminal', short_name: 'Terminal', url: '/terminal?source=shortcut', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
    ],
  };
}
