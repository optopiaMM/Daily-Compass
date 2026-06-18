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

/** Sort raw Graph messages newest-first by receivedDateTime (ISO 8601 UTC). */
function sortNewestFirst(items: any[]): any[] {
  return [...items].sort(
    (a, b) => new Date(b.receivedDateTime).getTime() - new Date(a.receivedDateTime).getTime(),
  );
}

/**
 * Run a Microsoft Graph $search over the mailbox and return the raw messages.
 * $search uses KQL and requires the `ConsistencyLevel: eventual` header. It
 * cannot be combined with $orderby, so callers sort the results in JS.
 * Returns null on a non-OK response (so callers can try the next strategy).
 */
async function searchMessages(
  accessToken: string,
  searchQuery: string,
): Promise<any[] | null> {
  // $search value must be a quoted KQL phrase; encode the whole thing.
  const search = encodeURIComponent(`"${searchQuery}"`);
  const url = `${GRAPH}/me/messages?$search=${search}&$top=25&$select=${MESSAGE_SELECT}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ConsistencyLevel: "eventual",
    },
  });
  if (!res.ok) {
    const text = await res.text();
    console.log(
      `[payslip:diag] getLatestMessageFromSender: $search ${searchQuery} failed (${res.status}). error=${text}`,
    );
    return null;
  }
  const body = (await res.json()) as { value?: any[] };
  return body.value ?? [];
}

/**
 * Returns the genuinely-newest message from a given sender, reliably even in a
 * very high-volume inbox where the sender's mail is far older than the newest
 * page. A plain $filter on `from` triggers Graph's InefficientFilter error, so
 * we use $search (KQL) instead:
 *
 *   1. PRIMARY  — $search="from:<full address>", sort newest-first in JS.
 *   2. DOMAIN   — if (1) is empty, $search="from:<domain>" (address may differ
 *                 slightly); log the from-addresses found.
 *   3. SCAN     — last resort: newest 50 messages with no filter, matched to the
 *                 sender address in JS (case-insensitive, trimmed).
 */
export async function getLatestMessageFromSender(
  accessToken: string,
  senderEmail: string,
): Promise<MailMessage | null> {
  const target = senderEmail.trim().toLowerCase();
  const domain = target.includes("@") ? target.slice(target.indexOf("@") + 1) : target;

  // --- 1. PRIMARY: $search by full from-address ---
  const primary = await searchMessages(accessToken, `from:${target}`);
  if (primary && primary.length > 0) {
    const sorted = sortNewestFirst(primary);
    logCandidates(`PRIMARY $search "from:${target}" (sorted newest-first)`, sorted);
    const m = sorted[0];
    console.log(
      `[payslip:diag] getLatestMessageFromSender: PRIMARY ($search from-address) selected received=${m.receivedDateTime} ` +
        `subject="${m.subject ?? "(no subject)"}" id=${m.id}`,
    );
    return toMailMessage(m);
  }
  console.log(
    `[payslip:diag] getLatestMessageFromSender: PRIMARY $search "from:${target}" returned 0 — trying domain search`,
  );

  // --- 2. DOMAIN: $search by domain only (address may differ slightly) ---
  const byDomain = await searchMessages(accessToken, `from:${domain}`);
  if (byDomain && byDomain.length > 0) {
    const sorted = sortNewestFirst(byDomain);
    const seen = Array.from(
      new Set(sorted.map((it) => (it.from?.emailAddress?.address ?? "(none)").trim().toLowerCase())),
    );
    logCandidates(`DOMAIN $search "from:${domain}" (sorted newest-first)`, sorted);
    console.log(
      `[payslip:diag] getLatestMessageFromSender: DOMAIN search from-addresses (${seen.length} distinct): ${seen.join(", ")}`,
    );
    const m = sorted[0];
    console.log(
      `[payslip:diag] getLatestMessageFromSender: DOMAIN ($search domain) selected received=${m.receivedDateTime} ` +
        `subject="${m.subject ?? "(no subject)"}" id=${m.id} from=${m.from?.emailAddress?.address ?? "(none)"}`,
    );
    return toMailMessage(m);
  }
  console.log(
    `[payslip:diag] getLatestMessageFromSender: DOMAIN $search "from:${domain}" returned 0 — trying last-resort scan`,
  );

  // --- 3. SCAN: newest 50 messages, no filter, matched in JS ---
  const scanUrl =
    `${GRAPH}/me/messages?$orderby=receivedDateTime%20desc&$top=50&$select=${MESSAGE_SELECT}`;
  const scanRes = await fetch(scanUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!scanRes.ok) {
    const text = await scanRes.text();
    throw new Error(`Graph messages query failed: ${scanRes.status} ${text}`);
  }
  const scanBody = (await scanRes.json()) as { value?: any[] };
  const all = scanBody.value ?? [];
  console.log(
    `[payslip:diag] getLatestMessageFromSender: SCAN fetched ${all.length} message(s) (newest 50, no filter); ` +
      `matching against "${target}"`,
  );
  const items = all.filter(
    (it) => (it.from?.emailAddress?.address ?? "").trim().toLowerCase() === target,
  );

  logCandidates(`SCAN JS-filtered to "${target}"`, items);
  if (items.length === 0) {
    const seen = Array.from(
      new Set(all.map((it) => (it.from?.emailAddress?.address ?? "(none)").trim().toLowerCase())),
    );
    console.log(
      `[payslip:diag] getLatestMessageFromSender: SCAN found no match for "${target}". ` +
        `From-addresses seen in newest 50 (${seen.length} distinct): ${seen.join(", ")}`,
    );
    return null;
  }

  // Page is already newest-first; first match is the newest from the sender.
  const m = items[0];
  console.log(
    `[payslip:diag] getLatestMessageFromSender: SCAN path selected received=${m.receivedDateTime} ` +
      `subject="${m.subject ?? "(no subject)"}" id=${m.id}`,
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
