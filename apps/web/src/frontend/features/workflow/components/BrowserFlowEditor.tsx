/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow designer — ported from FoxAgent (components/BrowserFlowEditor.tsx).
 */
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useEffect } from 'react';
import { Button, Input, Label, Select, Textarea } from './controls';

const STEP_TYPES = [
  'goto',
  'click',
  'fill',
  'press',
  'wait',
  'select',
  'hover',
  'scroll',
  'extractText',
  'extractHtml',
  'screenshot',
  'download',
  'saveCookies',
  'loadCookies',
  'eval',
] as const;

type StepType = (typeof STEP_TYPES)[number];

export type BrowserFlowStep = {
  type: StepType;
  [key: string]: unknown;
};

type FlowConfig = {
  steps: BrowserFlowStep[];
  credentialId?: string;
};

interface Props {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
}

function asSteps(value: unknown): BrowserFlowStep[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (row): row is Record<string, unknown> =>
        !!row && typeof row === 'object' && !Array.isArray(row),
    )
    .map((row) => {
      const type = STEP_TYPES.includes(row.type as StepType)
        ? (row.type as StepType)
        : 'goto';
      return { ...row, type };
    });
}

function emptyStep(type: StepType = 'goto'): BrowserFlowStep {
  switch (type) {
    case 'goto':
      return { type, url: 'https://' };
    case 'click':
    case 'hover':
      return { type, selector: '' };
    case 'fill':
      return { type, selector: '', value: '' };
    case 'press':
      return { type, key: 'Enter' };
    case 'wait':
      return { type, selector: '', state: 'visible' };
    case 'select':
      return { type, selector: '', value: '' };
    case 'scroll':
      return { type, y: 0 };
    case 'extractText':
      return { type, selector: '', outputField: 'text' };
    case 'extractHtml':
      return { type, selector: 'html', outputField: 'html' };
    case 'screenshot':
      return { type, fullPage: false };
    case 'download':
      return { type, selector: '' };
    case 'saveCookies':
    case 'loadCookies':
      return { type, credentialId: '' };
    case 'eval':
      return { type, script: '', outputField: 'result' };
  }
}

function stepSummary(step: BrowserFlowStep): string {
  const selector =
    typeof step.selector === 'string' && step.selector
      ? step.selector
      : undefined;
  const url = typeof step.url === 'string' ? step.url : undefined;
  const key = typeof step.key === 'string' ? step.key : undefined;
  return [step.type, selector ?? url ?? key].filter(Boolean).join(' · ');
}

export function BrowserFlowEditor({ config, onChange }: Props) {
  const steps = asSteps(config.steps);
  const credentialId =
    typeof config.credentialId === 'string' ? config.credentialId : '';

  const patch = (next: Partial<FlowConfig>) => {
    onChange({
      ...config,
      steps,
      ...(credentialId ? { credentialId } : {}),
      ...next,
    });
  };

  useEffect(() => {
    if (Array.isArray(config.steps) && config.steps.length > 0) return;
    onChange({
      ...config,
      steps: [emptyStep('goto')],
    });
  }, [config, onChange]);

  const updateStep = (index: number, next: BrowserFlowStep) => {
    patch({
      steps: steps.map((step, i) => (i === index ? next : step)),
    });
  };

  const moveStep = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= steps.length) return;
    const next = [...steps];
    [next[index], next[target]] = [next[target]!, next[index]!];
    patch({ steps: next });
  };

  return (
    <div className="browser-flow-editor">
      <p className="hint">
        Ordered browser actions in one solid node — same steps as record/codegen,
        without a canvas chain of click/fill/wait atoms.
      </p>

      <Label>Default credential id</Label>
      <Input
        value={credentialId}
        placeholder="site-login (optional)"
        onChange={(event) =>
          patch({
            credentialId: event.target.value.trim() || undefined,
          })
        }
      />

      {steps.length === 0 && (
        <p className="empty">No steps yet — add at least one action.</p>
      )}

      {steps.map((step, index) => (
        <div key={`${step.type}-${index}`} className="browser-flow-step">
          <div className="browser-flow-step-head">
            <strong>
              {index + 1}. {stepSummary(step)}
            </strong>
            <span className="browser-flow-step-actions">
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label="Move up"
                disabled={index === 0}
                onClick={() => moveStep(index, -1)}
              >
                <ArrowUp />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label="Move down"
                disabled={index === steps.length - 1}
                onClick={() => moveStep(index, 1)}
              >
                <ArrowDown />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label="Remove step"
                onClick={() =>
                  patch({ steps: steps.filter((_, i) => i !== index) })
                }
              >
                <Trash2 />
              </Button>
            </span>
          </div>

          <Label>Type</Label>
          <Select
            value={step.type}
            onChange={(event) =>
              updateStep(index, emptyStep(event.target.value as StepType))
            }
          >
            {STEP_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </Select>

          <StepFields
            step={step}
            onChange={(next) => updateStep(index, next)}
          />
        </div>
      ))}

      <Button
        type="button"
        onClick={() => patch({ steps: [...steps, emptyStep('click')] })}
      >
        <Plus /> Add step
      </Button>
    </div>
  );
}

function StepFields({
  step,
  onChange,
}: {
  step: BrowserFlowStep;
  onChange: (next: BrowserFlowStep) => void;
}) {
  const set = (key: string, value: unknown) =>
    onChange({ ...step, [key]: value });

  switch (step.type) {
    case 'goto':
      return (
        <>
          <Label>URL</Label>
          <Input
            value={String(step.url ?? '')}
            onChange={(event) => set('url', event.target.value)}
          />
        </>
      );
    case 'click':
    case 'hover':
      return (
        <>
          <Label>Selector</Label>
          <Input
            value={String(step.selector ?? '')}
            onChange={(event) => set('selector', event.target.value)}
          />
        </>
      );
    case 'fill':
      return (
        <>
          <Label>Selector</Label>
          <Input
            value={String(step.selector ?? '')}
            onChange={(event) => set('selector', event.target.value)}
          />
          <Label>Value (literal / {'{{field}}'})</Label>
          <Input
            value={String(step.value ?? '')}
            onChange={(event) => set('value', event.target.value)}
          />
          <Label>Secret field</Label>
          <Input
            value={String(step.secretField ?? '')}
            placeholder="username | password"
            onChange={(event) =>
              set('secretField', event.target.value.trim() || undefined)
            }
          />
          <Label>Credential id (override)</Label>
          <Input
            value={String(step.credentialId ?? '')}
            onChange={(event) =>
              set('credentialId', event.target.value.trim() || undefined)
            }
          />
        </>
      );
    case 'press':
      return (
        <>
          <Label>Key</Label>
          <Input
            value={String(step.key ?? '')}
            onChange={(event) => set('key', event.target.value)}
          />
        </>
      );
    case 'wait':
      return (
        <>
          <Label>Selector</Label>
          <Input
            value={String(step.selector ?? '')}
            onChange={(event) => set('selector', event.target.value)}
          />
          <Label>Delay ms</Label>
          <Input
            type="number"
            value={
              typeof step.delayMs === 'number' ? String(step.delayMs) : ''
            }
            onChange={(event) =>
              set(
                'delayMs',
                event.target.value === ''
                  ? undefined
                  : Number(event.target.value),
              )
            }
          />
        </>
      );
    case 'select':
      return (
        <>
          <Label>Selector</Label>
          <Input
            value={String(step.selector ?? '')}
            onChange={(event) => set('selector', event.target.value)}
          />
          <Label>Value</Label>
          <Input
            value={
              Array.isArray(step.value)
                ? step.value.join(',')
                : String(step.value ?? '')
            }
            onChange={(event) => set('value', event.target.value)}
          />
        </>
      );
    case 'scroll':
      return (
        <>
          <Label>Selector (optional)</Label>
          <Input
            value={String(step.selector ?? '')}
            onChange={(event) =>
              set('selector', event.target.value.trim() || undefined)
            }
          />
          <Label>Y</Label>
          <Input
            type="number"
            value={typeof step.y === 'number' ? String(step.y) : '0'}
            onChange={(event) => set('y', Number(event.target.value) || 0)}
          />
        </>
      );
    case 'extractText':
    case 'extractHtml':
      return (
        <>
          <Label>Selector</Label>
          <Input
            value={String(step.selector ?? '')}
            onChange={(event) => set('selector', event.target.value)}
          />
          <Label>Output field</Label>
          <Input
            value={String(step.outputField ?? '')}
            onChange={(event) => set('outputField', event.target.value)}
          />
        </>
      );
    case 'screenshot':
      return (
        <>
          <Label>Path (optional)</Label>
          <Input
            value={String(step.path ?? '')}
            onChange={(event) =>
              set('path', event.target.value.trim() || undefined)
            }
          />
        </>
      );
    case 'download':
      return (
        <>
          <Label>Selector or URL</Label>
          <Input
            value={String(step.selector ?? step.url ?? '')}
            onChange={(event) => set('selector', event.target.value)}
          />
        </>
      );
    case 'saveCookies':
    case 'loadCookies':
      return (
        <>
          <Label>Credential id</Label>
          <Input
            value={String(step.credentialId ?? '')}
            onChange={(event) => set('credentialId', event.target.value)}
          />
          <Label>Path (optional)</Label>
          <Input
            value={String(step.path ?? '')}
            onChange={(event) =>
              set('path', event.target.value.trim() || undefined)
            }
          />
        </>
      );
    case 'eval':
      return (
        <>
          <Label>Script</Label>
          <Textarea
            rows={3}
            value={String(step.script ?? '')}
            onChange={(event) => set('script', event.target.value)}
          />
          <Label>Output field</Label>
          <Input
            value={String(step.outputField ?? 'result')}
            onChange={(event) => set('outputField', event.target.value)}
          />
        </>
      );
    default:
      return null;
  }
}
