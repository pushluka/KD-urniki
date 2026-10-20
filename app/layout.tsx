import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "KD Grosuplje – Urniki",
  description: "Dogodki in razporedi ekipe KD Grosuplje",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="sl">
      <body>{children}</body>
    </html>
  );
}
