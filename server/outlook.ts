import crypto from "crypto";

const SCOPES = "Calendars.ReadWrite User.Read offline_access openid";

interface MsConfig {
  clientId: string;
  tenantId: string;
  authTenant: string;  // tenant segment for the OAuth URLs. "common" allows any work/school + personal accounts.
  clientSecret: string;
  redirectUri: string;
}

export function getMsConfig(): MsConfig {
  const clientId = process.env.MS_CLIENT_ID;
  const tenantId = process.env.MS_TENANT_ID;
  const clientSecret = process.env.MS_CLIENT_SECRET;
  const redirectUri = process.env.MS_REDIRECT_URI || "https://daily-compass-production.up.railway.app/api/outlook/callback";
  const authTenant = process.env.MS_AUTH_TENANT || "common";
  if (!clientId || !tenantId || !clientSecret) {
    throw new Error("Outlook OAuth not configured. Set MS_CLIENT_ID, MS_TENANT_ID, MS_CLIENT_SECRET env vars.");
  }
  return { clientId, tenantId, authTenant, clientSecret, redirectUri };
}

export function isMsConfigured(): boolean {
  return Boolean(process.env.MS_CLIENT_ID && process.env.MS_TENANT_ID && process.env.MS_CLIENT_SECRET);
}

function stateSecret(): string {
  return process.env.SESSION_SECRET || "fallback-session-secret-change-me";
}

export interface StatePayload {
  role: "read_write" | "read_only";
}

export function makeState(payload: StatePayload): string {
  const ts = Date.now();
  const nonce = crypto.randomBytes(8).toString("hex");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const data = `${ts}.${nonce}.${body}`;
  const hmac = crypto.createHmac("sha256", stateSecret()).update(data).digest("hex");
  return Buffer.from(`${data}.${hmac}`).toString("base64url");
}

export function validateAndParseState(state: string): StatePayload | null {
  try {
    const decoded = Buffer.from(state, "base64url").toString();
    const parts = decoded.split(".");
    if (parts.length !== 4) return null;
    const [ts, nonce, body, hmac] = parts;
    const expected = crypto.createHmac("sha256", stateSecret()).update(`${ts}.${nonce}.${body}`).digest("hex");
    if (!crypto.timingSafeEqual(Buffer.from(hmac, "hex"), Buffer.from(expected, "hex"))) return null;
    const age = Date.now() - parseInt(ts, 10);
    if (age < 0 || age >= 10 * 60 * 1000) return null;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as StatePayload;
    if (payload.role !== "read_write" && payload.role !== "read_only") return null;
    return payload;
  } catch {
    return null;
  }
}

export function buildAuthorizeUrl(payload: StatePayload): string {
  const cfg = getMsConfig();
  const state = makeState(payload);
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: "code",
    redirect_uri: cfg.redirectUri,
    response_mode: "query",
    scope: SCOPES,
    state,
    prompt: "select_account",
  });
  return `https://login.microsoftonline.com/${encodeURIComponent(cfg.authTenant)}/oauth2/v2.0/authorize?${params.toString()}`;
}

export function deriveAccountKey(email: string): string {
  const localPart = email.split("@")[0] ?? email;
  return localPart
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "account";
}

export interface MsTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
  id_token?: string;
}

export async function exchangeCodeForTokens(code: string): Promise<MsTokenResponse> {
  const cfg = getMsConfig();
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    redirect_uri: cfg.redirectUri,
    grant_type: "authorization_code",
    code,
    scope: SCOPES,
  });
  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(cfg.authTenant)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`Microsoft token exchange failed: ${json?.error_description || json?.error || res.statusText}`);
  }
  return json as MsTokenResponse;
}

export async function refreshAccessToken(refreshToken: string): Promise<MsTokenResponse> {
  const cfg = getMsConfig();
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    redirect_uri: cfg.redirectUri,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    scope: SCOPES,
  });
  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(cfg.authTenant)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`Microsoft token refresh failed: ${json?.error_description || json?.error || res.statusText}`);
  }
  return json as MsTokenResponse;
}

export interface MsUserProfile {
  displayName?: string;
  mail?: string;
  userPrincipalName?: string;
}

/**
 * Returns a working access token for a specific Outlook account, refreshing
 * via the stored refresh token if the current one expires within the next 60s.
 * The fresh access + refresh tokens are persisted back to the DB.
 */
export async function getValidAccessToken(accountKey: string): Promise<string> {
  const { storage } = await import("./storage");
  const token = await storage.getOauthToken("microsoft", accountKey);
  if (!token) throw new Error(`Outlook account "${accountKey}" is not connected.`);
  const expiresAtMs = new Date(token.expiresAt).getTime();
  const stillFreshFor = expiresAtMs - Date.now();
  if (stillFreshFor > 60_000) return token.accessToken;

  const refreshed = await refreshAccessToken(token.refreshToken);
  const newExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000);
  await storage.saveOauthToken({
    provider: "microsoft",
    accountKey: token.accountKey,
    role: token.role,
    accountEmail: token.accountEmail,
    accountName: token.accountName,
    accessToken: refreshed.access_token,
    refreshToken: refreshed.refresh_token ?? token.refreshToken,
    expiresAt: newExpiresAt,
    scope: refreshed.scope ?? token.scope,
  });
  return refreshed.access_token;
}

export async function getMsUserProfile(accessToken: string): Promise<MsUserProfile> {
  const res = await fetch("https://graph.microsoft.com/v1.0/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph /me failed: ${res.status} ${text}`);
  }
  return (await res.json()) as MsUserProfile;
}
