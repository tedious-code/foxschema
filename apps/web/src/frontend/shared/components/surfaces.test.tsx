/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * What the shared surfaces guarantee to the screens built out of them.
 *
 * These are presentation primitives, so the useful assertions are the ones a
 * redesign could break silently: that a tone still reaches the value, that the
 * provenance line is optional rather than rendered empty, and that every
 * caller's label comes out spelled the same way — the drift that motivated
 * extracting them in the first place.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SectionLabel, StatCard, Panel, sectionLabelCls } from './surfaces';

describe('SectionLabel', () => {
  it('is one spelling, so two callers cannot drift apart', () => {
    const { container } = render(
      <>
        <SectionLabel>Rows</SectionLabel>
        <SectionLabel>Null-heavy</SectionLabel>
      </>
    );
    const classes = [...container.querySelectorAll('p')].map((p) => p.className);
    expect(new Set(classes).size).toBe(1);
    expect(classes[0]).toBe(sectionLabelCls);
  });

  it('adds caller classes without dropping its own', () => {
    render(<SectionLabel className="mb-1">Scope</SectionLabel>);
    const el = screen.getByText('Scope');
    expect(el.className).toContain('mb-1');
    expect(el.className).toContain('uppercase');
  });
});

describe('StatCard', () => {
  it('carries the tone to the value, not the label', () => {
    render(<StatCard testId="c" label="Null-heavy" tone="warning" value="email" />);
    expect(screen.getByText('email').className).toContain('text-amber-200');
    expect(screen.getByText('Null-heavy').className).not.toContain('text-amber-200');
  });

  it('defaults to the neutral tone', () => {
    render(<StatCard testId="c" label="Rows" value="2.4M" />);
    expect(screen.getByText('2.4M').className).toContain('text-slate-100');
  });

  it('renders no hint line at all when there is no provenance to give', () => {
    // Not an empty <p>: a blank line under the number reads as a value that
    // failed to load, which is the opposite of "this figure needs no caveat".
    const { container } = render(<StatCard testId="c" label="Rows" value="12" />);
    expect(container.querySelectorAll('p')).toHaveLength(2);
  });

  it('keeps the hint when one is given', () => {
    render(<StatCard testId="c" label="Rows" value="12" hint="Estimated from catalog" />);
    expect(screen.getByText('Estimated from catalog')).toBeTruthy();
  });

  it('accepts a zero value rather than treating it as absent', () => {
    // `−0 Removed` is a real answer on a snapshot briefing, and a falsy check
    // here would blank it.
    render(<StatCard testId="zero" label="Removed" value={0} />);
    expect(screen.getByTestId('zero').textContent).toContain('0');
  });
});
