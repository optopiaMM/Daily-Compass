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

// `from` is included so the fallback path can filter to the sender in JS.
const MESSAGE_SELECT = "id,subject,receivedDateTime,hasAttachments,body,from";

/** Build a MailMessage from a raw Graph message resource. */
function toMailMessage(m: any): MailMessage {
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

/** [payslip:diag] Log the candidate list Graph returned, in the order returned. */
function logCandidates(label: string, items: any[]): void {
  console.log(`[payslip:diag] getLatestMessageFromSender: ${label} returned ${items.length} message(s)`);
  items.forEach((it, i) => {
    const parsed = new Date(it.receivedDateTime).getTime();
    console.log(
      `[payslip:diag]   candidate[${i}] received=${it.receivedDateTime} (epoch=${Number.isNaN(parsed) ? "UNPARSEABLE" : parsed}) ` +
        `subject="${it.subject ?? "(no subject)"}" id=${it.id}`,
    );
  });
}

/**
 * Returns the genuinely-newest message from a given sender.
 *
 * Primary path: ask Graph to do the ordering server-side with
 * $orderby=receivedDateTime desc + $top=1, combined with the `from` $filter.
 * Graph only permits $filter and $orderby together on messages when the request
 * is in "advanced query" mode, which requires the `ConsistencyLevel: eventual`
 * header and `$count=true` in the query string.
 *
 * Fallback path (if that combination still errors): fetch the newest 25 messages
 * ordered server-side WITHOUT a $filter, then filter to the sender in JS and take
 * the first (newest) match. This avoids the historical bug where $top with no
 * $orderby returned an arbitrary page that excluded the truly-newest email.
 */
export async function getLatestMessageFromSender(
  accessToken: string,
  senderEmail: string,
): Promise<MailMessage | null> {
  const addr = senderEmail.replace(/'/g, "''");
  const filter = encodeURIComponent(`from/emailAddress/address eq '${addr}'`);

  // --- Primary: server-side filter + order (advanced query mode) ---
  const primaryUrl =
    `${GRAPH}/me/messages?$filter=${filter}` +
    `&$orderby=receivedDateTime%20desc&$top=1&$count=true&$select=${MESSAGE_SELECT}`;
  const primaryRes = await fetch(primaryUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ConsistencyLevel: "eventual",
    },
  });

  if (primaryRes.ok) {
    const body = (await primaryRes.json()) as { value?: any[] };
    const items = body.value ?? [];
    logCandidates(`server-ordered from-filter "${senderEmail}" (orderby desc, $top=1)`, items);
    if (items.length === 0) {
      console.log("[payslip:diag] getLatestMessageFromSender: no messages matched the from-filter — returning null");
      return null;
    }
    const m = items[0];
    console.log(
      `[payslip:diag] getLatestMessageFromSender: selected received=${m.receivedDateTime} subject="${m.subject ?? "(no subject)"}" id=${m.id}`,
    );
    return toMailMessage(m);
  }

  // Primary failed — log why, then fall back to client-side filtering of a
  // server-ordered page.
  const primaryErr = await primaryRes.text();
  console.log(
    `[payslip:diag] getLatestMessageFromSender: server-ordered+filtered query failed (${primaryRes.status}); ` +
      `falling back to orderby-only + JS filter. error=${primaryErr}`,
  );

  // --- Fallback: server-side order, no $filter, filter to sender in JS ---
  const fallbackUrl =
    `${GRAPH}/me/messages?$orderby=receivedDateTime%20desc&$top=25&$select=${MESSAGE_SELECT}`;
  const fallbackRes = await fetch(fallbackUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!fallbackRes.ok) {
    const text = await fallbackRes.text();
    throw new Error(`Graph messages query failed: ${fallbackRes.status} ${text}`);
  }
  const fallbackBody = (await fallbackRes.json()) as { value?: any[] };
  const all = fallbackBody.value ?? [];
  const target = senderEmail.toLowerCase();
  const items = all.filter(
    (it) => (it.from?.emailAddress?.address ?? "").toLowerCase() === target,
  );

  logCandidates(`orderby-only fallback, JS-filtered to "${senderEmail}" (from newest 25)`, items);
  if (items.length === 0) {
    console.log(
      "[payslip:diag] getLatestMessageFromSender: fallback found no messages from sender in newest 25 — returning null",
    );
    return null;
  }

  // The page is already newest-first; first match is the newest from the sender.
  const m = items[0];
  console.log(
    `[payslip:diag] getLatestMessageFromSender: selected received=${m.receivedDateTime} subject="${m.subject ?? "(no subject)"}" id=${m.id}`,
  );
  return toMailMessage(m);
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
