/**
 * Slide-out panel showing full content of a single Gmail message.
 * Renders HTML body when present (e.g. NTT tickets), otherwise plain text.
 */
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import DOMPurify from "dompurify";
import type { GmailMessage } from "@/types/gmail";

function formatDate(dateStr: string): string {
  if (!dateStr) return "—";
  try {
    const d = new Date(dateStr);
    return Number.isNaN(d.getTime()) ? dateStr : d.toLocaleString();
  } catch {
    return dateStr;
  }
}

export interface EmailDetailSheetProps {
  email: GmailMessage | null;
  open: boolean;
  onClose: () => void;
}

export function EmailDetailSheet({
  email,
  open,
  onClose,
}: EmailDetailSheetProps) {
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl overflow-y-auto"
      >
        {email && (
          <>
            <SheetHeader className="text-left pr-8">
              <SheetTitle className="font-semibold text-foreground break-words">
                {email.subject || "(No subject)"}
              </SheetTitle>
            </SheetHeader>
            <div className="mt-4 space-y-4 text-sm">
              <div>
                <span className="text-muted-foreground font-medium">From: </span>
                <span className="text-foreground break-all">{email.from}</span>
              </div>
              <div>
                <span className="text-muted-foreground font-medium">Date: </span>
                <span className="text-foreground">{formatDate(email.date)}</span>
              </div>
              <div className="border-t border-border pt-4">
                <span className="text-muted-foreground font-medium block mb-2">Content</span>
                <div
                  className="text-foreground font-normal rounded-md bg-muted/30 p-4 min-h-[120px] max-h-[60vh] overflow-y-auto prose prose-sm dark:prose-invert max-w-none"
                  role="article"
                >
                  {email.bodyHtml?.trim() ? (
                    <div
                      dangerouslySetInnerHTML={{
                        __html: DOMPurify.sanitize(email.bodyHtml, {
                          ALLOWED_TAGS: [
                            "p", "br", "div", "span", "table", "thead", "tbody", "tr", "th", "td",
                            "h1", "h2", "h3", "h4", "strong", "b", "em", "i", "u", "a", "ul", "ol", "li",
                            "img", "hr", "blockquote", "pre", "code",
                          ],
                          ALLOWED_ATTR: ["href", "src", "alt", "title", "class", "style", "colspan", "rowspan"],
                        }),
                      }}
                    />
                  ) : email.body?.trim() ? (
                    <div className="whitespace-pre-wrap break-words">
                      {email.body}
                    </div>
                  ) : (
                    "(No body content)"
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
