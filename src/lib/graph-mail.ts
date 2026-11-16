// Microsoft Graph mail for candidate messages (assessment invitations and reminders).
// The result is one of three states, and they are kept apart on purpose:
//   accepted  — Graph took the request (HTTP 202). This is NOT proof that the message reached an inbox.
//   failed    — Graph refused it, or we never got as far as sending. Safe to try again.
//   uncertain — the request may or may not have gone through (timeout, dropped connection, 5xx).
//               Never retried automatically: HR checks the sender's Sent Items before issuing a replacement.
// Credentials stay on the server. Nothing here logs a message body or an invitation link.

export interface GraphConfig { tenantId: string; clientId: string; clientSecret: string; sender: string }
export interface GraphMessage { to: string; subject: string; html: string }
export interface GraphResult { state: 'accepted' | 'failed' | 'uncertain'; detail: string; ref: string }
export interface GraphMailer { configured: boolean; sender: string; send(msg: GraphMessage): Promise<GraphResult> }

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ status: number; headers: { get(name: string): string | null }; json(): Promise<unknown>; text(): Promise<string> }>;

export function graphConfigFromEnv(env: Record<string, string | undefined> = process.env): GraphConfig {
  return { tenantId: env.GRAPH_TENANT_ID || '', clientId: env.GRAPH_CLIENT_ID || '', clientSecret: env.GRAPH_CLIENT_SECRET || '', sender: env.GRAPH_SENDER || '' };
}

export function createGraphMailer(cfg: GraphConfig, fetchImpl: FetchLike = fetch as unknown as FetchLike): GraphMailer {
  const configured = !!(cfg.tenantId && cfg.clientId && cfg.clientSecret && cfg.sender);
  let token: { value: string; expires: number } | null = null;

  async function accessToken(): Promise<string> {
    if (token && token.expires > Date.now() + 60_000) return token.value;
    const body = new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }).toString();
    const res = await fetchImpl(`https://login.microsoftonline.com/${encodeURIComponent(cfg.tenantId)}/oauth2/v2.0/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(15_000) });
    if (res.status !== 200) throw new Error(`token request refused (${res.status})`);
    const j = await res.json() as { access_token?: string; expires_in?: number };
    if (!j.access_token) throw new Error('token response had no access token');
    token = { value: j.access_token, expires: Date.now() + (j.expires_in || 3000) * 1000 };
    return token.value;
  }

  return {
    configured, sender: cfg.sender,
    async send(msg: GraphMessage): Promise<GraphResult> {
      if (!configured) return { state: 'failed', detail: 'Microsoft 365 mail is not configured', ref: '' };
      let bearer: string;
      // Nothing has been sent yet at this point, so a failure here is a clean failure.
      try { bearer = await accessToken(); } catch (e) { return { state: 'failed', detail: `Could not sign in to Microsoft 365: ${(e as Error).message}`, ref: '' }; }
      const payload = JSON.stringify({ message: { subject: msg.subject, body: { contentType: 'HTML', content: msg.html }, toRecipients: [{ emailAddress: { address: msg.to } }] }, saveToSentItems: true });
      try {
        const res = await fetchImpl(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(cfg.sender)}/sendMail`, { method: 'POST', headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' }, body: payload, signal: AbortSignal.timeout(20_000) });
        const ref = res.headers.get('request-id') || res.headers.get('client-request-id') || '';
        if (res.status === 202) return { state: 'accepted', detail: 'Accepted by Microsoft 365. This is not proof of delivery to the inbox.', ref };
        if (res.status >= 500) return { state: 'uncertain', detail: `Microsoft 365 answered ${res.status}. The message may or may not have been sent.`, ref };
        return { state: 'failed', detail: `Microsoft 365 refused the message (${res.status}).`, ref };
      } catch (e) {
        return { state: 'uncertain', detail: `No clear answer from Microsoft 365 (${(e as Error).name}). The message may or may not have been sent.`, ref: '' };
      }
    }
  };
}
