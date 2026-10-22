import type { Metadata, Viewport } from "next";
import "./globals.css";
import { PwaStatus } from "@/components/pwa-status";
export const metadata: Metadata = {
  title: "KD Grosuplje – Urniki",
  description: "Dogodki in razporedi ekipe KD Grosuplje",
  applicationName: "KD Urniki",
  other: { "apple-mobile-web-app-capable": "yes" },
  appleWebApp: { capable: true, title: "KD Urniki", statusBarStyle: "default" },
  icons: { apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }] },
};
export const viewport: Viewport = {
  themeColor: "#e96b2c",
  width: "device-width",
  initialScale: 1,
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="sl">
      <body>
        {children}
        <PwaStatus />
      </body>
    </html>
  );
}
