import { MessageSquareIcon, PlusIcon } from "lucide-react";
import Link from "next/link";
import {
  combineChatUsage,
  formatChatUsage,
} from "@/app/(authenticated)/(manager)/_lib/chat-usage";
import { Button } from "@/components/ui/button";
import { listChats } from "@/db/services/chats";
import { requireRequestScope } from "@/lib/request-scope";

export const dynamic = "force-dynamic";

export default async function AllChatsPage() {
  const scope = await requireRequestScope();
  const chats = await listChats(scope);
  const totalUsage = combineChatUsage(chats.map((chat) => chat.usage));

  return (
    <div className="mx-auto w-full max-w-4xl space-y-8 px-4 py-6 sm:px-6 sm:py-8">
      <header className="flex items-start justify-between gap-6">
        <div>
          <h1 className="type-page-title">All chats</h1>
          <p className="type-supporting-body mt-1 text-muted-foreground">
            Every conversation in this workspace · Usage{" "}
            {formatChatUsage(totalUsage)}
          </p>
        </div>
        <Button nativeButton={false} render={<Link href="/chat" />} size="sm">
          <PlusIcon />
          New chat
        </Button>
      </header>

      <section aria-label="Chat history" className="border-t border-border">
        {chats.length === 0 ? (
          <div className="flex min-h-40 items-center gap-3 border-b border-border py-8 text-muted-foreground">
            <MessageSquareIcon className="size-5" />
            <p>No chats yet.</p>
          </div>
        ) : (
          chats.map((chat) => (
            <Link
              className="flex items-center gap-4 border-b border-border py-4 transition-colors hover:bg-muted/40"
              href={`/chat/${encodeURIComponent(chat.sessionId)}`}
              key={chat.sessionId}
            >
              <MessageSquareIcon className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{chat.title}</span>
              <span className="shrink-0 type-label text-muted-foreground">
                {formatChatUsage(chat.usage)}
              </span>
              <time
                className="shrink-0 type-label text-muted-foreground"
                dateTime={chat.updatedAt}
              >
                {formatChatDate(chat.updatedAt)}
              </time>
            </Link>
          ))
        )}
      </section>
    </div>
  );
}

function formatChatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}
