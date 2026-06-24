import type { ConversationReceipts } from "../../features/conversation/useConversation";
import type { ChatMessage } from "../../features/conversation/messages";
import { clockTime } from "../../lib/format";

type ReceiptStatus = "sent" | "delivered" | "seen";

/** One message. Own messages sit right with a faint accent tint; others left, neutral. */
export function MessageBubble({
  message,
  receipts,
}: {
  message: ChatMessage;
  receipts: ConversationReceipts;
}) {
  const mine = message.mine;
  const failed = message.status === "failed";
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[78%] rounded-2xl px-3.5 py-2 ${
          failed ? "bg-danger/12" : mine ? "bg-accent/15" : "bg-panel-dim"
        }`}
      >
        <p className="whitespace-pre-wrap wrap-break-word text-[13.5px] leading-relaxed text-fg">
          {message.body}
        </p>
        <div className="mt-1 flex items-center justify-end gap-1.5">
          <span className="font-mono text-[10px] text-fg-faint">
            {clockTime(message.createdAt)}
          </span>
          {mine && <Status message={message} receipts={receipts} />}
        </div>
      </div>
    </div>
  );
}

function Status({
  message,
  receipts,
}: {
  message: ChatMessage;
  receipts: ConversationReceipts;
}) {
  if (message.status === "sending") {
    return <span className="font-mono text-[10px] text-fg-faint">·</span>;
  }
  if (message.status === "failed") {
    return <span className="font-mono text-[10px] text-danger">failed</span>;
  }
  return <Receipt status={receiptStatus(message, receipts)} />;
}

/** sent ⇒ single check · delivered ⇒ double check · seen ⇒ double check, accent. */
function Receipt({ status }: { status: ReceiptStatus }) {
  const color = status === "seen" ? "text-accent-strong" : "text-fg-faint";
  const double = status !== "sent";
  return (
    <svg
      width="18"
      height="11"
      viewBox="0 0 18 11"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={color}
      aria-label={status}
    >
      <path d="M1 6l2.6 2.8L9 2.5" />
      {double && <path d="M7.5 6l2.6 2.8L17 2.5" />}
    </svg>
  );
}

function receiptStatus(
  message: ChatMessage,
  receipts: ConversationReceipts,
): ReceiptStatus {
  const id = message.id;
  if (!id) return "sent";
  if (receipts.readUpTo && id <= receipts.readUpTo) return "seen";
  if (receipts.deliveredUpTo && id <= receipts.deliveredUpTo)
    return "delivered";
  return "sent";
}
