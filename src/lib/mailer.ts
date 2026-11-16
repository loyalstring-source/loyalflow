// Outbound email. 'console' transport logs messages (development, tests); 'smtp' speaks SMTP with STARTTLS and AUTH LOGIN,
// which is what Microsoft 365 (smtp.office365.com:587) and most providers expect. No external dependencies.
import { connect as netConnect, type Socket } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import type { Config } from '../config.ts';

export interface Mail { to: string; subject: string; text: string; html?: string }
export interface Mailer { send(mail: Mail): Promise<{ ok: boolean; detail: string }>; readonly transport: string }

export const sentMails: Mail[] = []; // captured by the console transport (handy in tests)

export function createMailer(cfg: Config['mail']): Mailer {
  if (cfg.transport !== 'smtp' || !cfg.host || !cfg.user) {
    return {
      transport: 'console',
      async send(mail) {
        sentMails.push(mail);
        if (sentMails.length > 500) sentMails.shift();
        console.log(`[mail:console] to=${mail.to} subject="${mail.subject}"`);
        return { ok: true, detail: 'logged' };
      }
    };
  }
  return {
    transport: 'smtp',
    async send(mail) {
      try {
        await smtpSend(cfg, mail);
        return { ok: true, detail: 'accepted by SMTP server' };
      } catch (e) {
        console.error('[mail:smtp] failed', (e as Error).message);
        return { ok: false, detail: (e as Error).message };
      }
    }
  };
}

function buildMessage(from: string, mail: Mail): string {
  const boundary = 'lf' + Date.now().toString(36);
  const headers = [
    `From: ${from}`, `To: ${mail.to}`, `Subject: ${encodeHeader(mail.subject)}`, `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${Date.now()}.${Math.random().toString(36).slice(2)}@loyalflow>`, 'MIME-Version: 1.0'
  ];
  if (mail.html) {
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    const body = [`--${boundary}`, 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '', b64(mail.text),
      `--${boundary}`, 'Content-Type: text/html; charset=utf-8', 'Content-Transfer-Encoding: base64', '', b64(mail.html), `--${boundary}--`, ''].join('\r\n');
    return headers.join('\r\n') + '\r\n\r\n' + body;
  }
  headers.push('Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64');
  return headers.join('\r\n') + '\r\n\r\n' + b64(mail.text) + '\r\n';
}

function b64(s: string): string { return Buffer.from(s, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n'); }
function encodeHeader(s: string): string { return /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`; }
function addressOnly(s: string): string { const m = /<([^>]+)>/.exec(s); return m ? m[1] : s.trim(); }

class SmtpClient {
  private socket: Socket;
  private buffer = '';
  private waiters: ((line: string) => void)[] = [];
  constructor(socket: Socket) { this.socket = socket; this.attach(socket); }
  attach(socket: Socket) {
    this.socket = socket;
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      let idx: number;
      while ((idx = this.buffer.indexOf('\r\n')) >= 0) {
        const line = this.buffer.slice(0, idx); this.buffer = this.buffer.slice(idx + 2);
        if (/^\d{3} /.test(line)) { const w = this.waiters.shift(); if (w) w(line); }
      }
    });
  }
  reply(): Promise<string> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('SMTP timeout')), 20000);
      this.waiters.push((line) => { clearTimeout(t); resolve(line); });
    });
  }
  async cmd(line: string, expect: number[]): Promise<string> {
    this.socket.write(line + '\r\n');
    const r = await this.reply();
    if (!expect.includes(Number(r.slice(0, 3)))) throw new Error(`SMTP ${line.split(' ')[0]} failed: ${r}`);
    return r;
  }
  get raw() { return this.socket; }
}

async function smtpSend(cfg: Config['mail'], mail: Mail): Promise<void> {
  const socket = netConnect({ host: cfg.host, port: cfg.port });
  await new Promise<void>((resolve, reject) => { socket.once('connect', () => resolve()); socket.once('error', reject); });
  const client = new SmtpClient(socket);
  await client.reply();
  await client.cmd('EHLO loyalflow', [250]);
  if (cfg.starttls) {
    await client.cmd('STARTTLS', [220]);
    const tls = tlsConnect({ socket, host: cfg.host, servername: cfg.host });
    await new Promise<void>((resolve, reject) => { tls.once('secureConnect', () => resolve()); tls.once('error', reject); });
    socket.removeAllListeners('data');
    client.attach(tls);
    await client.cmd('EHLO loyalflow', [250]);
  }
  await client.cmd('AUTH LOGIN', [334]);
  await client.cmd(Buffer.from(cfg.user).toString('base64'), [334]);
  await client.cmd(Buffer.from(cfg.pass).toString('base64'), [235]);
  await client.cmd(`MAIL FROM:<${addressOnly(cfg.from)}>`, [250]);
  await client.cmd(`RCPT TO:<${addressOnly(mail.to)}>`, [250, 251]);
  await client.cmd('DATA', [354]);
  const msg = buildMessage(cfg.from, mail).replace(/\r\n\./g, '\r\n..');
  await client.cmd(msg + '\r\n.', [250]);
  await client.cmd('QUIT', [221]);
  client.raw.end();
}
