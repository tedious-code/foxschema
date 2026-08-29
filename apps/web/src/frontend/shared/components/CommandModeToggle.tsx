/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Command mode: the same statement as a shell command for the engine's own
 * client, for someone who would rather run it themselves.
 *
 * The password is never in the command. Fox Schema does not hold it in the
 * browser, and a password on a command line shows up in `ps` and in shell
 * history — so the client is told to prompt, and this says so before the user
 * runs something that appears to hang.
 */
import React, { useMemo, useState } from 'react';
import { Copy, Check, Terminal } from 'lucide-react';
import { buildCliCommand, type CliTarget } from '@foxschema/sql';

interface Props {
  sql: string;
  dialect: string;
  target: CliTarget;
  'data-testid'?: string;
}

export const CommandModeToggle: React.FC<Props> = ({
  sql,
  dialect,
  target,
  'data-testid': testId = 'command-mode',
}) => {
  const [copied, setCopied] = useState(false);

  const built = useMemo(
    () => (sql.trim() ? buildCliCommand(sql, dialect, target) : null),
    [sql, dialect, target]
  );

  if (!built) return null;

  if ('error' in built) {
    return (
      <p data-testid={`${testId}-error`} className="text-[11px] text-amber-200">
        {built.error}
      </p>
    );
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(built.command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard can be refused; the text is on screen to select by hand.
      setCopied(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5" data-testid={testId}>
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-400">
          <Terminal className="w-3.5 h-3.5" />
          Run it yourself — needs <code className="text-slate-300">{built.client}</code>
        </span>
        <button
          type="button"
          data-testid={`${testId}-copy`}
          onClick={() => void copy()}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-slate-600 bg-slate-800 text-[11px] font-bold text-slate-100 hover:bg-slate-700"
        >
          {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
          {copied ? 'Copied' : 'Copy command'}
        </button>
      </div>

      <pre
        data-testid={`${testId}-command`}
        className="whitespace-pre-wrap break-all rounded-md border border-slate-700 bg-slate-950 px-2.5 py-2 text-[11px] font-mono text-slate-200"
      >
        {built.command}
      </pre>

      <p className="text-[11px] text-slate-500">
        {built.explanation}
        {built.auth === 'prompts' && ' It waits for the password — that is the prompt, not a hang.'}
        {built.auth === 'none' && ' No login: file permissions decide who may write.'}
      </p>

      {built.note && <p className="text-[11px] text-slate-500">{built.note}</p>}
    </div>
  );
};
