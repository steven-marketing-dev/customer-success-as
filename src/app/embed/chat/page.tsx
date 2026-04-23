import { Suspense } from "react";
import { ChatEmbed } from "./ChatEmbed";

export const dynamic = "force-dynamic";

export default function EmbedChatPage() {
  return (
    <Suspense fallback={<div className="h-full w-full" />}>
      <ChatEmbed />
    </Suspense>
  );
}
