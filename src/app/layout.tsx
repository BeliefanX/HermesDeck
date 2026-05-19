import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import 'katex/dist/katex.min.css';
import 'highlight.js/styles/github-dark.css';
import './globals.css';
import { AppShell } from '@/components/AppShell';
import { GlobalErrorSink } from '@/components/GlobalErrorSink';
import { PWARegister } from '@/components/PWARegister';
import { ProfileProvider } from '@/lib/profile-context';

export const metadata: Metadata = {
  title: { default: 'HermesDeck', template: '%s · HermesDeck' },
  description: 'Hermes-native WebUI for multi-session chat, profiles, runs and safe ops.',
  applicationName: 'HermesDeck',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'HermesDeck',
    statusBarStyle: 'black-translucent',
  },
  formatDetection: { telephone: false },
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
    other: [{ rel: 'mask-icon', url: '/icons/maskable-512.png', color: '#38bdf8' }],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#08090c' },
    { media: '(prefers-color-scheme: light)', color: '#fafafa' },
  ],
};

const themeBootstrap = `(function(){try{var t=localStorage.getItem('hermesdeck-theme');var d=t||(window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark');document.documentElement.dataset.theme=d;}catch(e){document.documentElement.dataset.theme='dark';}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>
        {/* Theme bootstrap must run before hydration so the first paint uses
           the correct background; next/script with strategy="beforeInteractive"
           injects it into the document head and avoids the React 19 warning
           that fires for inline <script> children inside React components. */}
        <Script id="theme-bootstrap" strategy="beforeInteractive">
          {themeBootstrap}
        </Script>
        <GlobalErrorSink />
        <ProfileProvider>
          <AppShell>{children}</AppShell>
        </ProfileProvider>
        <PWARegister />
      </body>
    </html>
  );
}
