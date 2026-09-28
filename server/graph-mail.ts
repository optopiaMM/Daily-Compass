// server/graph-mail.ts
//
// Outlook / Microsoft Graph mail reading (and notification sending) for the payslip agent.
// Sits alongside graph.ts (which handles calendar). Requires the
// "Mail.Read" and "Mail.Send" scopes in the OAuth consent — see PAYSLIP-AGENT-SETUP.md.
//
// NOTE: this is the ONE module that depends on which mailbox the accountant
// emails into. This version reads Outlook via Graph. If the accountant emails
// Gmail instead, replace this file with a Gmail-API equivalent (same exported
// functions) or forward those emails into the connected Outlook
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

// `from` is included so results can be filtered to the sender domain in JS.
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
  console.log(`[payslip:diag] getLatestPayrollMessage: ${label} returned ${items.length} message(s)`);
  items.forEach((it, i) => {
    const parsed = new Date(it.receivedDateTime).getTime();
    console.log(
      `[payslip:diag]   candidate[${i}] received=${it.receivedDateTime} (epoch=${Number.isNaN(parsed) ? "UNPARSEABLE" : parsed}) ` +
        `from=${fromAddress(it) || "(none)"} hasAttachments=${!!it.hasAttachments} ` +
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

/** Lower-cased, trimmed from-address of a raw Graph message ("" if absent). */
function fromAddress(m: any): string {
  return (m.from?.emailAddress?.address ?? "").trim().toLowerCase();
}

/** Distinct from-addresses in a list, for [payslip:diag] logging. */
function distinctFrom(items: any[]): string[] {
  return Array.from(new Set(items.map((it) => fromAddress(it) || "(none)")));
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
      `[payslip:diag] getLatestPayrollMessage: $search ${searchQuery} failed (${res.status}). error=${text}`,
    );
    return null;
  }
  const body = (await res.json()) as { value?: any[] };
  return body.value ?? [];
}

/**
 * Returns the newest message from ANY sender at a given domain (e.g.
 * "carpenterbox.com") that HAS an attachment — the payroll email carries the
 * payslip zip, while other mail from the firm (follow-ups, queries) usually
 * doesn't. Reliable even in a very high-volume inbox where that mail is far
 * older than the newest page. A plain $filter on `from` triggers Graph's
 * InefficientFilter error, so we use $search (KQL) instead:
 *
 *   1. SEARCH — $search="from:<domain>", keep only from-addresses ending in
 *               "@<domain>" (case-insensitive; KQL matching is fuzzy) that
 *               have attachments, sort newest-first in JS.
 *   2. SCAN   — if (1) fails or finds nothing: newest 50 messages with no
 *               filter, matched the same way in JS.
 *
 * Returns null if no recent domain email has an attachment.
 */
export async function getLatestPayrollMessage(
  accessToken: string,
  senderDomain: string,
): Promise<MailMessage | null> {
  const domain = senderDomain.trim().toLowerCase().replace(/^@/, "");
  const suffix = `@${domain}`;
  const matchesDomain = (m: any) => fromAddress(m).endsWith(suffix);
  const isCandidate = (m: any) => matchesDomain(m) && !!m.hasAttachments;

  // --- 1. SEARCH: $search by domain, then strict suffix match in JS ---
  const searched = await searchMessages(accessToken, `from:${domain}`);
  if (searched && searched.length > 0) {
    const sorted = sortNewestFirst(searched);
    logCandidates(`SEARCH $search "from:${domain}" (sorted newest-first)`, sorted);
    const seen = distinctFrom(sorted);
    console.log(
      `[payslip:diag] getLatestPayrollMessage: SEARCH from-addresses (${seen.length} distinct): ${seen.join(", ")}`,
    );
    const domainCount = sorted.filter(matchesDomain).length;
    const items = sorted.filter(isCandidate);
    if (items.length > 0) {
      const m = items[0];
      console.log(
        `[payslip:diag] getLatestPayrollMessage: SEARCH selected newest "${suffix}" message with attachments ` +
          `(${domainCount} of ${sorted.length} matched the domain, ${items.length} with attachments) received=${m.receivedDateTime} ` +
          `from=${fromAddress(m)} hasAttachments=${!!m.hasAttachments} subject="${m.subject ?? "(no subject)"}" id=${m.id}`,
      );
      return toMailMessage(m);
    }
    console.log(
      `[payslip:diag] getLatestPayrollMessage: SEARCH found ${domainCount} "${suffix}" message(s) but none with attachments — trying last-resort scan`,
    );
  } else {
    console.log(
      `[payslip:diag] getLatestPayrollMessage: SEARCH $search "from:${domain}" returned ${searched ? 0 : "an error"} — trying last-resort scan`,
    );
  }

  // --- 2. SCAN: newest 50 messages, no filter, matched to the domain in JS ---
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
    `[payslip:diag] getLatestPayrollMessage: SCAN fetched ${all.length} message(s) (newest 50, no filter); ` +
      `matching from-addresses ending in "${suffix}"`,
  );
  const domainItems = all.filter(matchesDomain);
  const items = domainItems.filter((m) => !!m.hasAttachments);

  logCandidates(`SCAN JS-filtered to "${suffix}"`, domainItems);
  if (items.length === 0) {
    const seen = distinctFrom(all);
    console.log(
      `[payslip:diag] getLatestPayrollMessage: SCAN found ${domainItems.length} "${suffix}" message(s), none with attachments. ` +
        `From-addresses seen in newest 50 (${seen.length} distinct): ${seen.join(", ")}`,
    );
    return null;
  }

  // Page is already newest-first; first match is the newest qualifying message.
  const m = items[0];
  console.log(
    `[payslip:diag] getLatestPayrollMessage: SCAN path selected newest "${suffix}" message with attachments received=${m.receivedDateTime} ` +
      `from=${fromAddress(m)} hasAttachments=${!!m.hasAttachments} subject="${m.subject ?? "(no subject)"}" id=${m.id}`,
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

/**
 * Sends an HTML email from the connected account's mailbox. Requires the
 * "Mail.Send" delegated scope — see PAYSLIP-AGENT-SETUP.md.
 */
export async function sendMail(
  accessToken: string,
  to: string,
  subject: string,
  bodyHtml: string,
): Promise<void> {
  const res = await fetch(`${GRAPH}/me/sendMail`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: "HTML", content: bodyHtml },
        toRecipients: [{ emailAddress: { address: to } }],
      },
      saveToSentItems: true,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph sendMail failed: ${res.status} ${text}`);
  }
}
