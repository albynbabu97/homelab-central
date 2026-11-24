import type { Metadata, Viewport } from "next";
import "./globals.css";
import RegisterSW from "./register-sw";
export const metadata: Metadata = {
  title: 'Homelab Central',
  description: 'Private homelab control center',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Homelab Central' },
  icons: {
    icon: [{ url: '/icon.svg', type: 'image/svg+xml' }, { url: '/icon-192.png', sizes: '192x192', type: 'image/png' }],
    apple: '/icon-192.png',
  },
};
export const viewport: Viewport = { themeColor: "#0b1220", width: "device-width", initialScale: 1 };
export default function RootLayout({children}:{children:React.ReactNode}) { return <html lang="en"><body><RegisterSW/>{children}</body></html>; }
