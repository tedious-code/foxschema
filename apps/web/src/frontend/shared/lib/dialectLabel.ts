/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * The name to show a user for a dialect.
 *
 * `dialect` is a wire value — 'sqlserver', 'cockroachdb' — and reads badly on
 * screen. The provider table already carries a written name, so use it, and
 * fall back to the raw value for a dialect the table does not know rather than
 * rendering nothing.
 */
import { PROVIDER_SETTINGS } from '@/shared/lib/provider-settings';

export function dialectLabel(dialect: string): string {
  if (!dialect?.trim()) return '';
  return PROVIDER_SETTINGS[dialect.toLowerCase()]?.label ?? dialect.toUpperCase();
}
