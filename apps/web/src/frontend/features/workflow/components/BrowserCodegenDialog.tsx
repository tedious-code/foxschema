/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow designer — ported from FoxAgent (components/BrowserCodegenDialog.tsx).
 */
import { Wand2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from '../lib/notify';
import { api } from '../api/engineClient';
import { Button, Input, Label, Textarea } from './controls';

interface Props {
  open: boolean;
  /** Prefill for the new workflow id. */
  defaultId?: string;
  /** Existing workflow ids — reject duplicates before compile. */
  existingIds: string[];
  onApply: (
    workflow: unknown,
    warnings: Array<{ code: string; step: number; message: string }>,
  ) => void;
  onClose: () => void;
}

/**
 * Paste Playwright Codegen / Inspector output → compile → load onto canvas.
 */
export function BrowserCodegenDialog({
  open,
  defaultId = '',
  existingIds,
  onApply,
  onClose,
}: Props) {
  const [id, setId] = useState(defaultId);
  const [credentialId, setCredentialId] = useState('');
  const [source, setSource] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setId(defaultId);
    setCredentialId('');
    setSource('');
    setBusy(false);
  }, [open, defaultId]);

  if (!open) return null;

  const compile = async () => {
    const workflowId = id.trim();
    if (!workflowId) {
      toast.error('Workflow id is required');
      return;
    }
    if (existingIds.includes(workflowId)) {
      toast.error(`"${workflowId}" already exists — pick another id or open it`);
      return;
    }
    if (!source.trim()) {
      toast.error('Paste Playwright Codegen output');
      return;
    }
    setBusy(true);
    try {
      const { workflow, warnings } = await api.compileBrowserCodegen({
        id: workflowId,
        name: workflowId,
        source,
        ...(credentialId.trim()
          ? { credentialId: credentialId.trim() }
          : {}),
        callable: false,
      });
      onApply(workflow, warnings ?? []);
      onClose();
    } catch (error) {
      toast.error('Codegen compile failed', {
        description: (error as Error).message,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="trigger-dialog-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <section
        className="trigger-dialog browser-codegen-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Import from Playwright codegen"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="trigger-dialog-titlebar">
          <div className="trigger-title">
            <span className="trigger-title-icon">
              <Wand2 size={19} />
            </span>
            <div>
              <h2>From Playwright codegen</h2>
              <p>
                Paste Inspector / Codegen output. Username and password fills
                remap to a credential when you set one below.
              </p>
            </div>
          </div>
          <div className="trigger-dialog-actions">
            <Button variant="primary" onClick={() => void compile()} disabled={busy}>
              <Wand2 /> Compile
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              aria-label="Close"
            >
              <X />
            </Button>
          </div>
        </header>

        <div className="browser-codegen-body">
          <div className="trigger-form-grid">
            <div>
              <Label htmlFor="codegen-id">Workflow id</Label>
              <Input
                id="codegen-id"
                value={id}
                placeholder="recorded-login"
                onChange={(event) => setId(event.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="codegen-cred">Credential id (optional)</Label>
              <Input
                id="codegen-cred"
                value={credentialId}
                placeholder="site-login"
                onChange={(event) => setCredentialId(event.target.value)}
              />
            </div>
            <div className="span-2">
              <Label htmlFor="codegen-source">Codegen source</Label>
              <Textarea
                id="codegen-source"
                rows={14}
                value={source}
                placeholder={`await page.goto('https://example.com/login');\nawait page.fill('#username', 'alice');\nawait page.fill('#password', '…');\nawait page.click('button[type=submit]');`}
                onChange={(event) => setSource(event.target.value)}
              />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
