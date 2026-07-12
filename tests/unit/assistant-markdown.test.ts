import { describe, expect, it } from 'vitest';
import { normalizeLatexDelimiters } from '../../src/sidepanel/assistant-markdown';

describe('assistant markdown', () => {
  it('normalizes LaTeX inline and display delimiters', () => {
    expect(normalizeLatexDelimiters(String.raw`步数是 \(2^n - 1\)。`)).toBe(
      '步数是 $2^n - 1$。',
    );
    expect(
      normalizeLatexDelimiters(String.raw`递推式：\[T(n)=2T(n-1)+1\]完成。`),
    ).toBe('递推式：\n\n$$\nT(n)=2T(n-1)+1\n$$\n\n完成。');
  });

  it('leaves formulas inside inline and fenced code unchanged', () => {
    const source = [
      String.raw`示例：\(\alpha\)`,
      '代码：`\\(\\beta\\)`',
      '```tex',
      String.raw`\[\gamma\]`,
      '```',
    ].join('\n');

    expect(normalizeLatexDelimiters(source)).toBe(
      [
        String.raw`示例：$\alpha$`,
        '代码：`\\(\\beta\\)`',
        '```tex',
        String.raw`\[\gamma\]`,
        '```',
      ].join('\n'),
    );
  });

  it('keeps unmatched and escaped delimiters as text', () => {
    const source = String.raw`未闭合 \(x + 1，转义 \\(y\\)。`;
    expect(normalizeLatexDelimiters(source)).toBe(source);
  });
});
