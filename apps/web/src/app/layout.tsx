import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "alpha-ten",
  description: "Describe an app and watch alpha-ten build it."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
