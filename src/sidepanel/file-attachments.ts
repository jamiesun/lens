import {
  MAX_AGENT_ATTACHMENT_BYTES,
  MAX_AGENT_ATTACHMENT_COUNT,
  type AgentAttachment,
} from '../protocol/agent-events';

const SUPPORTED_EXTENSIONS = new Set([
  'c',
  'cc',
  'cpp',
  'css',
  'csv',
  'go',
  'h',
  'hpp',
  'htm',
  'html',
  'java',
  'js',
  'json',
  'jsx',
  'log',
  'markdown',
  'md',
  'mjs',
  'py',
  'rs',
  'sql',
  'text',
  'toml',
  'ts',
  'tsx',
  'tsv',
  'txt',
  'xml',
  'yaml',
  'yml',
]);

const SUPPORTED_APPLICATION_TYPES = new Set([
  'application/json',
  'application/ld+json',
  'application/sql',
  'application/toml',
  'application/xml',
  'application/x-httpd-php',
  'application/x-javascript',
  'application/x-ndjson',
  'application/x-sh',
  'application/x-yaml',
]);

export const FILE_ATTACHMENT_ACCEPT = [
  'text/*',
  ...Array.from(SUPPORTED_EXTENSIONS, (extension) => `.${extension}`),
].join(',');

export class FileAttachmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FileAttachmentError';
  }
}

function extensionOf(filename: string): string {
  return filename.split('.').at(-1)?.toLowerCase() ?? '';
}

function isSupportedTextFile(file: File): boolean {
  const mimeType = file.type.trim().toLowerCase();
  return (
    mimeType.startsWith('text/') ||
    SUPPORTED_APPLICATION_TYPES.has(mimeType) ||
    SUPPORTED_EXTENSIONS.has(extensionOf(file.name))
  );
}

function normalizedMimeType(file: File): string {
  const mimeType = file.type.trim().toLowerCase();
  return /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(mimeType)
    ? mimeType
    : 'text/plain';
}

function containsBinaryControls(content: string): boolean {
  const sample = content.slice(0, 8_192);
  let controls = 0;
  for (let index = 0; index < sample.length; index += 1) {
    const code = sample.charCodeAt(index);
    if (code === 0) {
      return true;
    }
    if ((code < 9 || (code > 13 && code < 32)) && code !== 27) {
      controls += 1;
    }
  }
  return sample.length > 0 && controls / sample.length > 0.02;
}

export async function readFileAttachments(
  files: Iterable<File>,
  existing: AgentAttachment[] = [],
): Promise<AgentAttachment[]> {
  const selected = Array.from(files);
  if (selected.length === 0) {
    return existing;
  }
  if (existing.length + selected.length > MAX_AGENT_ATTACHMENT_COUNT) {
    throw new FileAttachmentError(
      `最多可添加 ${MAX_AGENT_ATTACHMENT_COUNT} 个文件。`,
    );
  }

  const existingNames = new Set(
    existing.map((attachment) => attachment.name.toLocaleLowerCase()),
  );
  let totalBytes = existing.reduce(
    (total, attachment) => total + attachment.size,
    0,
  );

  for (const file of selected) {
    const name = file.name.trim();
    if (!name || name.length > 180 || /[\u0000-\u001f]/.test(name)) {
      throw new FileAttachmentError('文件名无效或过长。');
    }
    const normalizedName = name.toLocaleLowerCase();
    if (existingNames.has(normalizedName)) {
      throw new FileAttachmentError(`“${name}”已添加。`);
    }
    existingNames.add(normalizedName);

    if (!isSupportedTextFile(file)) {
      throw new FileAttachmentError(
        `“${name}”不是受支持的文本、代码或数据文件。`,
      );
    }
    if (file.size === 0) {
      throw new FileAttachmentError(`“${name}”是空文件。`);
    }
    if (file.size > MAX_AGENT_ATTACHMENT_BYTES) {
      throw new FileAttachmentError(
        `“${name}”超过单个文件 32 KB 的限制。`,
      );
    }
    totalBytes += file.size;
  }

  if (totalBytes > MAX_AGENT_ATTACHMENT_BYTES * MAX_AGENT_ATTACHMENT_COUNT) {
    throw new FileAttachmentError('附件总大小超过 128 KB 的限制。');
  }

  const additions = await Promise.all(
    selected.map(async (file): Promise<AgentAttachment> => {
      let content: string;
      try {
        content = (await file.text()).replace(/^\uFEFF/, '');
      } catch {
        throw new FileAttachmentError(`无法读取“${file.name}”。`);
      }
      if (!content || containsBinaryControls(content)) {
        throw new FileAttachmentError(`“${file.name}”不是可读取的文本文件。`);
      }
      return {
        name: file.name.trim(),
        mimeType: normalizedMimeType(file),
        size: file.size,
        content,
      };
    }),
  );

  return [...existing, ...additions];
}

export function formatFileSize(bytes: number): string {
  return bytes < 1_024
    ? `${bytes} B`
    : `${Math.max(1, Math.round(bytes / 1_024))} KB`;
}
