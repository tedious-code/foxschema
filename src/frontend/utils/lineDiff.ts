export interface DiffLine {
  type: 'unchanged' | 'added' | 'removed';
  text: string;
  /** Line number on the target/old side (left). */
  oldLine?: number;
  /** Line number on the source/new side (right). */
  newLine?: number;
}

/**
 * Line-based diff via longest common subsequence, like git/GitHub.
 * `oldText` is the target (destination) DDL, `newText` is the source DDL:
 * 'added' lines exist only in source, 'removed' only in target.
 */
export function diffLines(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const n = oldLines.length;
  const m = newLines.length;

  // LCS table
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = oldLines[i] === newLines[j]
        ? lcs[i + 1][j + 1] + 1
        : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      result.push({ type: 'unchanged', text: oldLines[i], oldLine: i + 1, newLine: j + 1 });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      result.push({ type: 'removed', text: oldLines[i], oldLine: i + 1 });
      i++;
    } else {
      result.push({ type: 'added', text: newLines[j], newLine: j + 1 });
      j++;
    }
  }
  while (i < n) {
    result.push({ type: 'removed', text: oldLines[i], oldLine: i + 1 });
    i++;
  }
  while (j < m) {
    result.push({ type: 'added', text: newLines[j], newLine: j + 1 });
    j++;
  }

  return result;
}
