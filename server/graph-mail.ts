// server/graph-mail.ts
//
// Outlook / Microsoft Graph mail reading for the payslip agent.
// Sits alongside graph.ts (which handles calendar). Requires the
// "Mail.Read" scope to be added to the OAuth consent — see PAYSLIP-AGENT-SETUP.md.
//
// NOTE: this is the ONE module that depends on which mailbox the accountant
// emails into. This version reads Outlook via Graph. If the accountant emails
// Gmail instead, replace this file with a Gmail-API equivalent (same two
// exported functions) or forward those emails into the connected Outlook
// account.

const GRAPH = "https://graph.microsoft.com/v1.0";

export interface MailMessage {
  id: string;
  subject: string;
  receivedDateTime: string; // ISO 8601 (UTC, from Graph)
  bodyText: string;
  hasAttachments: boolean;
}

export interface MailAttachment {
  name: string;
  contentType: string;
  contentBytes: string; // base64
}

/** Crudely strip HTML to plain text so the email body reads cleanly for the model. */
function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Returns the most recent message from a given sender. Graph dislikes
 * combining $filter (on `from`) with $orderby (on a different property),
 * so we pull the latest few from the sender and pick the newest in JS.
 */
export async function getLatestMessageFromSender(
  accessToken: string,
  senderEmail: string,
): Promise<MailMessage | null> {
  const filter = encodeURIComponent(`from/emailAddress/address eq '${senderEmail.replace(/'/g, "''")}'`);
  const select = "id,subject,receivedDateTime,hasAttachments,body";
  const url = `${GRAPH}/me/messages?$filter=${filter}&$top=10&$select=${select}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph messages query failed: ${res.status} ${text}`);
  }
  const body = (await res.json()) as { value?: any[] };
  const items = body.value ?? [];
  if (items.length === 0) return null;

  items.sort(
    (a, b) => new Date(b.receivedDateTime).getTime() - new Date(a.receivedDateTime).getTime(),
  );
  const m = items[0];
  const rawBody: string = m.body?.content ?? "";
  const bodyText = m.body?.contentType === "html" ? htmlToText(rawBody) : rawBody.trim();

  return {
    id: m.id,
    subject: m.subject ?? "(no subject)",
    receivedDateTime: m.receivedDateTime,
    bodyText,
    hasAttachments: !!m.hasAttachments,
  };
}

/** Returns file attachments (with base64 contentBytes) for a message. */
export async function getMessageAttachments(
  accessToken: string,
  messageId: string,
): Promise<MailAttachment[]> {
  // List attachments without selecting contentBytes — it isn't a property on the
  // base attachment type, so Graph rejects the $select with a 400.
  const listUrl = `${GRAPH}/me/messages/${encodeURIComponent(messageId)}/attachments?$select=id,name,contentType`;
  const listRes = await fetch(listUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!listRes.ok) {
    const text = await listRes.text();
    throw new Error(`Graph attachments query failed: ${listRes.status} ${text}`);
  }
  const listBody = (await listRes.json()) as { value?: any[] };
  const fileAttachments = (listBody.value ?? []).filter(
    (a) => a["@odata.type"] === "#microsoft.graph.fileAttachment",
  );

  const attachments: MailAttachment[] = [];
  for (const a of fileAttachments) {
    // Fetch the individual attachment to get contentBytes, which is only
    // returned on the full fileAttachment resource (not the collection list).
    const itemUrl = `${GRAPH}/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(a.id)}`;
    const itemRes = await fetch(itemUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!itemRes.ok) {
      const text = await itemRes.text();
      throw new Error(`Graph attachment fetch failed: ${itemRes.status} ${text}`);
    }
    const item = (await itemRes.json()) as any;
    if (!item.contentBytes) continue;
    attachments.push({
      name: item.name ?? a.name ?? "attachment",
      contentType: item.contentType ?? a.contentType ?? "application/octet-stream",
      contentBytes: item.contentBytes as string,
    });
  }
  return attachments;
}
