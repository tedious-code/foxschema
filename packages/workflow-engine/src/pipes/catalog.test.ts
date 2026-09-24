/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { createDefaultPipeRegistry } from './utility/index.js';
import { PIPE_FAMILIES } from '../common/index.js';

/**
 * The palette groups pipes by the part of `category` before the slash, so a
 * one-off spelling becomes a one-pipe group: "Write CSV file" once sat alone
 * under "Sink" beside every other output under "Output", and "Ask a person"
 * alone under "Control". These are the groups, in the order a pipeline reads.
 */
const GROUPS = ['Trigger', 'Source', 'Transform', 'Logic', 'Output'] as const;

describe('built-in pipe catalog', () => {
  const pipes = createDefaultPipeRegistry().listMetadata();

  it('files every pipe under one of the palette groups', () => {
    for (const pipe of pipes) {
      const group = pipe.category.split('/')[0]!;
      expect(GROUPS, `${pipe.type} is in "${pipe.category}"`).toContain(group);
    }
  });

  it('puts sources under Source or Trigger and sinks under Output', () => {
    for (const pipe of pipes) {
      const group = pipe.category.split('/')[0];
      if (pipe.role === 'sink') expect(group, pipe.type).toBe('Output');
      if (pipe.role === 'source') expect(['Source', 'Trigger'], pipe.type).toContain(group);
    }
  });

  it('gives every pipe a distinct palette label', () => {
    // Two pipes both called "HTTP request" left the designer showing the same
    // name for a lookup and a send.
    const seen = new Map<string, string>();
    for (const pipe of pipes) {
      if (pipe.role === 'source' && pipe.category === 'Trigger') continue; // one class, per kind
      const other = seen.get(pipe.name);
      expect(other, `${pipe.type} and ${other} are both "${pipe.name}"`).toBeUndefined();
      seen.set(pipe.name, pipe.type);
    }
  });

  it('names a known family for every pipe', () => {
    for (const pipe of pipes) {
      expect(PIPE_FAMILIES, `${pipe.type} has family ${String(pipe.family)}`).toContain(pipe.family);
    }
  });
});
