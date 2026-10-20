import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "Novo geslo – KD Grosuplje",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};
export default function RecoveryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
