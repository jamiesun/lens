import { describe, expect, it } from 'vitest';
import {
  AgentRunRequestSchema,
  MAX_AGENT_ATTACHMENT_BYTES,
} from '../../src/protocol/agent-events';
import {
  FileAttachmentError,
  readFileAttachments,
} from '../../src/sidepanel/file-attachments';

describe('file attachments', () => {
  it('reads supported text files and normalizes missing MIME types', async () => {
    const attachments = await readFileAttachments([
      new File(['# Brief\nProject: ORBIT-42'], 'brief.md'),
    ]);

    expect(attachments).toEqual([
      {
        name: 'brief.md',
        mimeType: 'text/plain',
        size: 25,
        content: '# Brief\nProject: ORBIT-42',
      },
    ]);
    expect(
      AgentRunRequestSchema.safeParse({
        type: 'lens.agent.run',
        goal: 'Read the brief',
        history: [],
        attachments,
      }).success,
    ).toBe(true);
  });

  it('rejects an unsupported selection without mutating existing attachments', async () => {
    const existing = [
      {
        name: 'notes.txt',
        mimeType: 'text/plain',
        size: 5,
        content: 'hello',
      },
    ];

    await expect(
      readFileAttachments(
        [new File([new Uint8Array([0, 1, 2])], 'diagram.png')],
        existing,
      ),
    ).rejects.toThrow(FileAttachmentError);
    expect(existing).toHaveLength(1);
    expect(existing[0]?.name).toBe('notes.txt');
  });

  it('rejects oversized and binary-looking text files', async () => {
    await expect(
      readFileAttachments([
        new File(
          ['x'.repeat(MAX_AGENT_ATTACHMENT_BYTES + 1)],
          'oversized.txt',
          { type: 'text/plain' },
        ),
      ]),
    ).rejects.toThrow('32 KB');

    await expect(
      readFileAttachments([
        new File(['hello\u0000world'], 'binary.txt', { type: 'text/plain' }),
      ]),
    ).rejects.toThrow('不是可读取的文本文件');
  });
});
