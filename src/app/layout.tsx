import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Customer Success KB",
  description: "Knowledge Base auto-alimentada desde HubSpot",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-screen bg-slate-50">
        {children}
      </body>
    </html>
  );
}
