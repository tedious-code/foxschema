/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Write text to the clipboard, reporting success rather than throwing.
 *
 * `navigator.clipboard` rejects when the document is not focused, the page
 * lacks clipboard permission, or the context is insecure. Callers use the
 * result to decide whether to say "Copied" — saying it after a refusal leaves
 * the user pasting whatever was there before.
 */
export async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
