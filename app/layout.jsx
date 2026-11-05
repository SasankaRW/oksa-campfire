import './globals.css';
import { EVENT } from '@/lib/config';
import { THEME } from '@/lib/theme';

export const metadata = {
  title: `${EVENT.title} · ${EVENT.org}`,
  description: 'Lay your log. Watch the fire catch.',
};
// viewportFit 'cover' lets the night sky run under the notch; the UI keeps clear of it with the --safe-* insets
export const viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: THEME.bg };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400&family=Inter:wght@400;500&family=Caveat:wght@500&family=Noto+Serif+Sinhala:wght@500;600&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
