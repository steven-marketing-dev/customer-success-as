import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Customer Success KB",
  description: "AI-powered knowledge base for customer success teams",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen pattern-warm">
        {children}
      </body>
    </html>
  );
}
