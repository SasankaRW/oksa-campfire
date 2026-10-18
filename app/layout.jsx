import './globals.css';
import { EVENT } from '@/lib/config';

export const metadata = {
  title: `${EVENT.title} · ${EVENT.org}`,
  description: 'Lay your log. Watch the fire catch.',
};
export const viewport = { width: 'device-width', initialScale: 1, themeColor: '#05070b' };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400&family=Inter:wght@400;500&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
