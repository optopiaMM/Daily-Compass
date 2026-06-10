import crypto from "crypto";

const SCOPES = "Calendars.ReadWrite User.Read offline_access openid";

interface MsConfig {
  clientId: string;
  tenantId: string;
  clientSecret: string;
  redirectUri: string;
}

export function getMsConfig(): MsConfig {
  const clientId = process.env.MS_CLIENT_ID;
  const tenantId = process.env.MS_TENANT_ID;
  const clientSecret = process.env.MS_CLIENT_SECRET;
  const redirectUri = process.env.MS_REDIRECT_URI || "https://daily-compass-production.up.railway.app/api/outlook/callback";
  if (!clientId || !tenantId || !clientSecret) {
    throw new Error("Outlook OAuth not configured. Set MS_CLIENT_ID, MS_TENANT_ID, MS_CLIENT_SECRET env vars.");
  }
  return { clientId, tenantId, clientSecret, redirectUri };
}

export function isMsConfigured(): boolean {
  return Boolean(process.env.MS_CLIENT_ID && process.env.MS_TENANT_ID && process.env.MS_CLIENT_SECRET);
}

function stateSecret(): string {
  return process.env.SESSION_SECRET || "fallback-session-secret-change-me";
}

export function makeState(): string {
  const ts = Date.now();
  const nonce = crypto.randomBytes(8).toString("hex");
  const data = `${ts}.${nonce}`;
  const hmac = crypto.createHmac("sha256", stateSecret()).update(data).digest("hex");
  return Buffer.from(`${data}.${hmac}`).toString("base64url");
}

export function validateState(state: string): boolean {
  try {
    const decoded = Buffer.from(state, "base64url").toString();
    const parts = decoded.split(".");
    if (parts.length !== 3) return false;
    const [ts, nonce, hmac] = parts;
    const expected = crypto.createHmac("sha256", stateSecret()).update(`${ts}.${nonce}`).digest("hex");
    if (!crypto.timingSafeEqual(Buffer.from(hmac, "hex"), Buffer.from(expected, "hex"))) return false;
    const age = Date.now() - parseInt(ts, 10);
    return age >= 0 && age < 10 * 60 * 1000;
  } catch {
    return false;
  }
}

export function buildAuthorizeUrl(): string {
  const cfg = getMsConfig();
  const state = makeState();
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: "code",
    redirect_uri: cfg.redirectUri,
    response_mode: "query",
    scope: SCOPES,
    state,
    prompt: "select_account",
  });
  return `https://login.microsoftonline.com/${encodeURIComponent(cfg.tenantId)}/oauth2/v2.0/authorize?${params.toString()}`;
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
  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(cfg.tenantId)}/oauth2/v2.0/token`, {
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
  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(cfg.tenantId)}/oauth2/v2.0/token`, {
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
