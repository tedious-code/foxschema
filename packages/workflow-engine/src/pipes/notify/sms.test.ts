/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * The SMS sink against recorded provider calls.
 */
import { describe, expect, it, vi } from 'vitest';
import type { CredentialStore } from '../../common/index.js';
import type { PipeContext, RecordBatch } from '../../registry/index.js';
import { SmsSinkPipe, normalizePhoneNumber } from './sms.js';

const ACCOUNT_SID = `AC${'a'.repeat(32)}`;
const SERVICE_SID = `MG${'b'.repeat(32)}`;
const TWILIO = { accountSid: ACCOUNT_SID, authToken: 'twilio-token' };

function context(
  config: Record<string, unknown>,
  secret: Record<string, unknown>,
  extra: Partial<PipeContext> = {},
): PipeContext {
  return {
    workflowRunId: 'run',
    pipelineId: 'pipeline',
    pipe: { id: 'sms', type: 'sink.notify.sms', role: 'sink', config, concurrency: 1, credentialId: 'sms' },
    credentials: { revealSecret: async () => secret } as unknown as CredentialStore,
    ...extra,
  };
}

const batchOf = (records: Record<string, unknown>[]): RecordBatch => ({ id: 'b', partitionId: '0', records });

function calls(fetchImpl: ReturnType<typeof vi.fn>) {
  return fetchImpl.mock.calls.map(([url, init]) => ({
    url: String(url),
    headers: new Headers((init as RequestInit).headers),
    form: Object.fromEntries(new URLSearchParams(String((init as RequestInit).body))),
  }));
}

describe('sink.notify.sms', () => {
  it('sends a Twilio message to each recipient, numbers normalised', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ sid: 'SM1' }, { status: 201 }));
    await new SmsSinkPipe({ fetch: fetchImpl as unknown as typeof fetch }).write(
      batchOf([{ id: 1 }, { id: 2 }]),
      context(
        { from: '+1 (555) 000-1111', to: ['+1 555 222 3333', '{{vars.onCall}}'], body: '{{count}} jobs failed' },
        TWILIO,
        { variables: { onCall: '+44 7700 900123' } },
      ),
    );

    const sent = calls(fetchImpl);
    expect(sent.map((call) => call.form)).toEqual([
      { To: '+15552223333', Body: '2 jobs failed', From: '+15550001111' },
      { To: '+447700900123', Body: '2 jobs failed', From: '+15550001111' },
    ]);
    expect(sent[0]!.url).toBe(`https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`);
    expect(sent[0]!.headers.get('authorization')).toBe(
      `Basic ${Buffer.from(`${ACCOUNT_SID}:twilio-token`).toString('base64')}`,
    );
  });

  it('sends from a Messaging Service when the sender is one', async () => {
    const fetchImpl = vi.fn(async () => Response.json({}, { status: 201 }));
    await new SmsSinkPipe({ fetch: fetchImpl as unknown as typeof fetch }).write(
      batchOf([{}]),
      context({ from: SERVICE_SID, to: '+15552223333', body: 'hi' }, TWILIO),
    );
    expect(calls(fetchImpl)[0]!.form).toEqual({ To: '+15552223333', Body: 'hi', MessagingServiceSid: SERVICE_SID });
  });

  it('sends through Vonage and fails on a message part Vonage did not send', async () => {
    const accepted = vi.fn(async () => Response.json({ messages: [{ status: '0' }] }));
    await new SmsSinkPipe({ fetch: accepted as unknown as typeof fetch }).write(
      batchOf([{}]),
      context({ provider: 'vonage', from: 'FoxSchema', to: '+447700900123', body: 'hi' }, { apiKey: 'k', apiSecret: 's' }),
    );
    expect(calls(accepted)[0]).toMatchObject({
      url: 'https://rest.nexmo.com/sms/json',
      form: { api_key: 'k', api_secret: 's', from: 'FoxSchema', to: '447700900123', text: 'hi' },
    });

    const rejected = vi.fn(async () => Response.json({ messages: [{ status: '4', 'error-text': 'Bad Credentials' }] }));
    await expect(
      new SmsSinkPipe({ fetch: rejected as unknown as typeof fetch }).write(
        batchOf([{}]),
        context({ provider: 'vonage', from: 'FoxSchema', to: '+447700900123', body: 'hi' }, { apiKey: 'k', apiSecret: 'wrong' }),
      ),
    ).rejects.toThrow('Vonage refused the message to +447700900123: Bad Credentials');
  });

  it('checks every number before sending to any', async () => {
    const fetchImpl = vi.fn(async () => Response.json({}, { status: 201 }));
    await expect(
      new SmsSinkPipe({ fetch: fetchImpl as unknown as typeof fetch }).write(
        batchOf([{}]),
        context({ from: '+15550001111', to: ['+15552223333', '555-0199'], body: 'hi' }, TWILIO),
      ),
    ).rejects.toThrow(/international format/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses a body longer than an SMS allows', async () => {
    const fetchImpl = vi.fn();
    await expect(
      new SmsSinkPipe({ fetch: fetchImpl as unknown as typeof fetch }).write(
        batchOf([{}]),
        context({ from: '+15550001111', to: '+15552223333', body: 'x'.repeat(1_601) }, TWILIO),
      ),
    ).rejects.toThrow(/1601 characters/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses an account SID that is not one, since it goes into the URL', async () => {
    const fetchImpl = vi.fn();
    await expect(
      new SmsSinkPipe({ fetch: fetchImpl as unknown as typeof fetch }).write(
        batchOf([{}]),
        context({ from: '+15550001111', to: '+15552223333', body: 'hi' }, { accountSid: '../Accounts/other', authToken: 't' }),
      ),
    ).rejects.toThrow(/not an account SID/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('normalizePhoneNumber', () => {
  it.each([
    ['+1 (555) 000-1111', '+15550001111'],
    ['+44 7700.900.123', '+447700900123'],
  ])('normalises %s', (input, expected) => {
    expect(normalizePhoneNumber(input)).toBe(expected);
  });

  it.each(['5550001111', '+0123456789', '+1'])('rejects %s', (input) => {
    expect(() => normalizePhoneNumber(input)).toThrow();
  });
});
