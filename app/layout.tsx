import "./globals.css";
import "highlight.js/styles/github-dark.css";

export const metadata = {
  title: "Ask OLake",
  description: "Chat with the OLake docs",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
