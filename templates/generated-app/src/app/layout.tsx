import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Generated app",
  description: "An alpha-ten generated app."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
