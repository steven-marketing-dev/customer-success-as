import type { ReactNode } from "react";

export default function EmbedLayout({ children }: { children: ReactNode }) {
  return <div className="embed-root h-screen w-screen overflow-hidden bg-transparent">{children}</div>;
}
