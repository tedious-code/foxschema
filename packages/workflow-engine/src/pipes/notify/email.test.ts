/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * The email sink with its transports replaced: what it would send, to whom,
 * and through what.
 */
import { describe, expect, it, vi } from 'vitest';
import type { CredentialStore } from '../../common/index.js';
import type { PipeContext, RecordBatch } from '../../registry/index.js';
import { EmailSinkPipe } from './email.js';
import type { MailMessage, SmtpOptions } from './smtp.js';

const SMTP = { host: 'smtp.example.com', port: 587, username: 'reports', password: 'smtp-pw' };

function context(
  config: Record<string, unknown>,
  secret: Record<string, unknown> | undefined,
  extra: Partial<PipeContext> = {},
): PipeContext {
  return {
    workflowRunId: 'run',
    pipelineId: 'pipeline',
    pipe: { id: 'mail', type: 'sink.notify.email', role: 'sink', config, concurrency: 1, credentialId: 'mail' },
    credentials: { revealSecret: async () => secret } as unknown as CredentialStore,
    ...extra,
  };
}

const batchOf = (records: Record<string, unknown>[]): RecordBatch => ({ id: 'b', partitionId: '0', records });

function smtpRecorder(failFor?: string) {
  const sent: Array<{ options: SmtpOptions; message: MailMessage }> = [];
  const sendMail = async (options: SmtpOptions, message: MailMessage) => {
    if (failFor && message.to.includes(failFor)) throw new Error('mailbox unavailable');
    sent.push({ options, message });
  };
  return { sent, sendMail };
}

describe('sink.notify.email', () => {
  it('sends one summary per batch over SMTP, filled from variables, trigger and batch', async () => {
    const smtp = smtpRecorder();
    await new EmailSinkPipe({ sendMail: smtp.sendMail }).write(
      batchOf([{ id: 7 }, { id: 8 }]),
      context(
        {
          from: 'Reports <reports@example.com>',
          to: '{{vars.alerts}}',
          subject: '{{count}} orders failed on {{trigger.date}}',
          text: 'First failure: {{records.0.id}}',
        },
        SMTP,
        { variables: { alerts: 'ops@example.com, lead@example.com' }, invocation: { payload: { date: '2026-09-14' } } as never },
      ),
    );

    expect(smtp.sent).toHaveLength(1);
    expect(smtp.sent[0]!.options).toEqual({ ...SMTP, security: 'starttls', allowInsecureAuth: false });
    expect(smtp.sent[0]!.message).toEqual({
      from: 'Reports <reports@example.com>',
      to: ['ops@example.com', 'lead@example.com'],
      subject: '2 orders failed on 2026-09-14',
      text: 'First failure: 7',
    });
  });

  it('uses implicit TLS on port 465 unless the credential says otherwise', async () => {
    const smtp = smtpRecorder();
    const config = { from: 'a@example.com', to: 'b@example.com', subject: 's', text: 't' };
    const sink = new EmailSinkPipe({ sendMail: smtp.sendMail });
    await sink.write(batchOf([{}]), context(config, { ...SMTP, port: 465 }));
    await sink.write(batchOf([{}]), context(config, { ...SMTP, port: 465, security: 'starttls' }));
    expect(smtp.sent.map((entry) => entry.options.security)).toEqual(['tls', 'starttls']);
  });

  it('sends one message per record, with the record’s fields', async () => {
    const smtp = smtpRecorder();
    await new EmailSinkPipe({ sendMail: smtp.sendMail }).write(
      batchOf([{ email: 'ana@example.com', name: 'Ana' }, { email: 'bo@example.com', name: 'Bo' }]),
      context({ mode: 'record', from: 'a@example.com', to: '{{email}}', subject: 'Hi {{record.name}}', text: '.' }, SMTP),
    );
    expect(smtp.sent.map((entry) => [entry.message.to, entry.message.subject])).toEqual([
      [['ana@example.com'], 'Hi Ana'],
      [['bo@example.com'], 'Hi Bo'],
    ]);
  });

  it('escapes values placed into the HTML body, and only there', async () => {
    const smtp = smtpRecorder();
    await new EmailSinkPipe({ sendMail: smtp.sendMail }).write(
      batchOf([{ note: '<img src=x onerror=alert(1)>' }]),
      context(
        { mode: 'record', from: 'a@example.com', to: 'b@example.com', subject: 's', text: '{{note}}', html: '<p>{{note}}</p>' },
        SMTP,
      ),
    );
    expect(smtp.sent[0]!.message.html).toBe('<p>&lt;img src=x onerror=alert(1)&gt;</p>');
    expect(smtp.sent[0]!.message.text).toBe('<img src=x onerror=alert(1)>');
  });

  it('moves past a message that cannot be sent when onError is skip, and fails the batch otherwise', async () => {
    const records = [{ email: 'gone@example.com' }, { email: 'ok@example.com' }];
    const config = { mode: 'record', from: 'a@example.com', to: '{{email}}', subject: 's', text: 't' };

    const skipping = smtpRecorder('gone@example.com');
    await new EmailSinkPipe({ sendMail: skipping.sendMail }).write(
      batchOf(records),
      context({ ...config, onError: 'skip' }, SMTP),
    );
    expect(skipping.sent.map((entry) => entry.message.to[0])).toEqual(['ok@example.com']);

    const failing = smtpRecorder('gone@example.com');
    await expect(
      new EmailSinkPipe({ sendMail: failing.sendMail }).write(batchOf(records), context(config, SMTP)),
    ).rejects.toThrow('mailbox unavailable');
  });

  it('posts to SendGrid with the API key, Bcc recipients included', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 202 }));
    await new EmailSinkPipe({ fetch: fetchImpl as unknown as typeof fetch }).write(
      batchOf([{}]),
      context(
        {
          transport: 'sendgrid',
          from: 'Reports <reports@example.com>',
          to: 'ops@example.com',
          bcc: 'audit@example.com',
          subject: 'Done',
          text: 'ok',
        },
        { apiKey: 'sg-key' },
      ),
    );
    const [url, init] = fetchImpl.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe('https://api.sendgrid.com/v3/mail/send');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer sg-key');
    expect(JSON.parse(String(init.body))).toEqual({
      from: { email: 'reports@example.com', name: 'Reports' },
      personalizations: [{ to: [{ email: 'ops@example.com' }], bcc: [{ email: 'audit@example.com' }] }],
      subject: 'Done',
      content: [{ type: 'text/plain', value: 'ok' }],
    });
  });

  it('posts to Resend, and reports a refusal by status only', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) =>
      Response.json({ message: 'echoed body with details' }, { status: 422 }),
    );
    const failure = new EmailSinkPipe({ fetch: fetchImpl as unknown as typeof fetch }).write(
      batchOf([{}]),
      context({ transport: 'resend', from: 'a@example.com', to: 'b@example.com', subject: 's', html: '<b>x</b>' }, { apiKey: 're-key' }),
    );
    await expect(failure).rejects.toThrow('Resend refused the message: HTTP 422');
    await expect(failure).rejects.not.toThrow(/echoed/);
    expect(fetchImpl.mock.calls[0]![0]).toBe('https://api.resend.com/emails');
  });

  it('needs a credential, and a body', async () => {
    const sink = new EmailSinkPipe({ sendMail: smtpRecorder().sendMail });
    const noCredential = context({ from: 'a@example.com', to: 'b@example.com', subject: 's', text: 't' }, SMTP);
    delete noCredential.pipe.credentialId;
    await expect(sink.write(batchOf([{}]), noCredential)).rejects.toThrow(/needs an email credential/);
    expect(() => sink.validateConfig({ from: 'a@example.com', to: 'b@example.com', subject: 's' })).toThrow(/text, html or both/);
  });
});
