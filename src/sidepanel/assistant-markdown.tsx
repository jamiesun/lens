import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import remarkMath from 'remark-math';

interface Fence {
  marker: '`' | '~';
  size: number;
  openingEnd: number;
}

const mathSanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [['className', /^language-./, 'math-inline', 'math-display']],
  },
};

function countRun(source: string, start: number, character: string): number {
  let cursor = start;
  while (source[cursor] === character) {
    cursor += 1;
  }
  return cursor - start;
}

function lineEnd(source: string, start: number): number {
  const newline = source.indexOf('\n', start);
  return newline === -1 ? source.length : newline + 1;
}

function readFence(source: string, start: number): Fence | undefined {
  if (start > 0 && source[start - 1] !== '\n') {
    return undefined;
  }

  let cursor = start;
  while (cursor - start < 4 && source[cursor] === ' ') {
    cursor += 1;
  }
  if (cursor - start > 3) {
    return undefined;
  }

  const marker = source[cursor];
  if (marker !== '`' && marker !== '~') {
    return undefined;
  }

  const size = countRun(source, cursor, marker);
  if (size < 3) {
    return undefined;
  }

  return {
    marker,
    size,
    openingEnd: lineEnd(source, cursor + size),
  };
}

function findFenceEnd(source: string, fence: Fence): number {
  let start = fence.openingEnd;
  while (start < source.length) {
    const end = lineEnd(source, start);
    const contentEnd = source[end - 1] === '\n' ? end - 1 : end;
    let cursor = start;
    while (cursor - start < 4 && source[cursor] === ' ') {
      cursor += 1;
    }

    if (cursor - start <= 3) {
      const size = countRun(source, cursor, fence.marker);
      if (
        size >= fence.size &&
        source.slice(cursor + size, contentEnd).trim().length === 0
      ) {
        return end;
      }
    }
    start = end;
  }
  return source.length;
}

function findCodeSpanEnd(source: string, start: number): number | undefined {
  const size = countRun(source, start, '`');
  let cursor = start + size;

  while (cursor < source.length) {
    const candidate = source.indexOf('`', cursor);
    if (candidate === -1) {
      return undefined;
    }
    const candidateSize = countRun(source, candidate, '`');
    if (candidateSize === size) {
      return candidate + size;
    }
    cursor = candidate + candidateSize;
  }
  return undefined;
}

function findMathEnd(
  source: string,
  start: number,
  closingDelimiter: '\\)' | '\\]',
  allowNewlines: boolean,
): number {
  let braceDepth = 0;
  let cursor = start;

  while (cursor < source.length) {
    const character = source[cursor];
    if (!allowNewlines && character === '\n') {
      return -1;
    }
    if (
      braceDepth === 0 &&
      source.startsWith(closingDelimiter, cursor)
    ) {
      return cursor;
    }
    if (character === '\\') {
      cursor += 2;
      continue;
    }
    if (character === '{') {
      braceDepth += 1;
    } else if (character === '}') {
      braceDepth = Math.max(0, braceDepth - 1);
    }
    cursor += 1;
  }
  return -1;
}

function isEscaped(source: string, index: number): boolean {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === '\\'; cursor -= 1) {
    slashes += 1;
  }
  return slashes % 2 === 1;
}

function missingLineBreaksBefore(source: string): string {
  if (source.length === 0 || source.endsWith('\n\n')) {
    return '';
  }
  return source.endsWith('\n') ? '\n' : '\n\n';
}

function missingLineBreaksAfter(source: string): string {
  if (source.length === 0 || source.startsWith('\n\n')) {
    return '';
  }
  return source.startsWith('\n') ? '\n' : '\n\n';
}

function normalizeMathInText(source: string): string {
  let output = '';
  let plainStart = 0;
  let cursor = 0;

  while (cursor < source.length - 1) {
    const isInline = source.startsWith('\\(', cursor);
    const isDisplay = source.startsWith('\\[', cursor);
    if ((!isInline && !isDisplay) || isEscaped(source, cursor)) {
      cursor += 1;
      continue;
    }

    const end = findMathEnd(
      source,
      cursor + 2,
      isInline ? '\\)' : '\\]',
      isDisplay,
    );
    if (end === -1) {
      cursor += 2;
      continue;
    }

    output += source.slice(plainStart, cursor);
    const expression = source.slice(cursor + 2, end);
    if (isInline) {
      output += `$${expression}$`;
    } else {
      const remainder = source.slice(end + 2);
      output +=
        missingLineBreaksBefore(output) +
        `$$\n${expression.trim()}\n$$` +
        missingLineBreaksAfter(remainder);
    }

    cursor = end + 2;
    plainStart = cursor;
  }

  return output + source.slice(plainStart);
}

export function normalizeLatexDelimiters(source: string): string {
  let output = '';
  let plainStart = 0;
  let cursor = 0;

  while (cursor < source.length) {
    const fence = readFence(source, cursor);
    if (fence) {
      const end = findFenceEnd(source, fence);
      output += normalizeMathInText(source.slice(plainStart, cursor));
      output += source.slice(cursor, end);
      cursor = end;
      plainStart = end;
      continue;
    }

    if (source[cursor] === '`') {
      const end = findCodeSpanEnd(source, cursor);
      if (end !== undefined) {
        output += normalizeMathInText(source.slice(plainStart, cursor));
        output += source.slice(cursor, end);
        cursor = end;
        plainStart = end;
        continue;
      }
    }
    cursor += 1;
  }

  return output + normalizeMathInText(source.slice(plainStart));
}

export function AssistantMarkdown({ children }: { children: string }) {
  return (
    <div className="assistant-markdown">
      <ReactMarkdown
        skipHtml
        disallowedElements={['img']}
        remarkPlugins={[remarkMath]}
        rehypePlugins={[
          [rehypeSanitize, mathSanitizeSchema],
          [
            rehypeKatex,
            { errorColor: '#f28b82', strict: 'ignore', trust: false },
          ],
        ]}
      >
        {normalizeLatexDelimiters(children)}
      </ReactMarkdown>
    </div>
  );
}
