export interface StoredScreenshot {
  dataUrl: string;
  filename: string;
  mimeType: 'image/png' | 'image/jpeg';
  width: number;
  height: number;
  mode: 'viewport' | 'full-page';
  truncated: boolean;
}

export interface StoredFileAttachment {
  name: string;
  mimeType: string;
  size: number;
}

export interface StoredChatEntry {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
  attachments?: StoredFileAttachment[];
  screenshot?: StoredScreenshot;
}

export interface ConversationRecord {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: StoredChatEntry[];
}

export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
}

interface PersistedConversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

interface PersistedScreenshotMetadata {
  id: string;
  filename: string;
  mimeType: 'image/png' | 'image/jpeg';
  width: number;
  height: number;
  mode: 'viewport' | 'full-page';
  truncated: boolean;
}

interface PersistedMessage extends Omit<StoredChatEntry, 'screenshot'> {
  conversationId: string;
  screenshot?: PersistedScreenshotMetadata;
}

interface ScreenshotBlobRecord {
  id: string;
  conversationId: string;
  blob: Blob;
}

interface LegacyConversation extends PersistedConversation {
  messages: Array<
    Omit<StoredChatEntry, 'screenshot'> & {
      screenshot?: StoredScreenshot | PersistedScreenshotMetadata;
    }
  >;
}

const DATABASE_NAME = 'lens-chat-history';
const DATABASE_VERSION = 3;
const CONVERSATIONS = 'conversations';
const SUMMARIES = 'summaries';
const MESSAGES = 'messages';
const SCREENSHOTS = 'screenshots';
const META = 'meta';
const CURRENT_CONVERSATION = 'currentConversationId';
const MAX_CONVERSATIONS = 30;

function requestAsPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error('IndexedDB request failed.'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction aborted.'));
  });
}

export class HistoryRepository {
  private databasePromise?: Promise<IDBDatabase>;
  private operationTail: Promise<void> = Promise.resolve();

  private openDatabase(): Promise<IDBDatabase> {
    this.databasePromise ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        const transaction = request.transaction!;
        const conversationStore = database.objectStoreNames.contains(
          CONVERSATIONS,
        )
          ? transaction.objectStore(CONVERSATIONS)
          : database.createObjectStore(CONVERSATIONS, { keyPath: 'id' });
        const summaryStore = database.objectStoreNames.contains(SUMMARIES)
          ? transaction.objectStore(SUMMARIES)
          : database.createObjectStore(SUMMARIES, { keyPath: 'id' });
        const messageStore = database.objectStoreNames.contains(MESSAGES)
          ? transaction.objectStore(MESSAGES)
          : database.createObjectStore(MESSAGES, { keyPath: 'id' });
        if (!messageStore.indexNames.contains('conversationId')) {
          messageStore.createIndex('conversationId', 'conversationId');
        }
        const screenshotStore = database.objectStoreNames.contains(SCREENSHOTS)
          ? transaction.objectStore(SCREENSHOTS)
          : database.createObjectStore(SCREENSHOTS, { keyPath: 'id' });
        if (!screenshotStore.indexNames.contains('conversationId')) {
          screenshotStore.createIndex('conversationId', 'conversationId');
        }
        if (!database.objectStoreNames.contains(META)) {
          database.createObjectStore(META);
        }

        migrateLegacyConversations(
          conversationStore,
          summaryStore,
          messageStore,
          screenshotStore,
        );
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error('Could not open chat history.'));
      request.onblocked = () =>
        reject(new Error('Chat history database upgrade was blocked.'));
    });
    return this.databasePromise;
  }

  async loadCurrent(): Promise<ConversationRecord | undefined> {
    const database = await this.openDatabase();
    const transaction = database.transaction(
      [CONVERSATIONS, META],
      'readonly',
    );
    const currentId = await requestAsPromise(
      transaction.objectStore(META).get(CURRENT_CONVERSATION),
    );
    const conversation =
      typeof currentId === 'string'
        ? await requestAsPromise(
            transaction.objectStore(CONVERSATIONS).get(currentId),
          )
        : undefined;
    await transactionDone(transaction);
    return isPersistedConversation(conversation)
      ? this.hydrate(database, conversation)
      : undefined;
  }

  async get(id: string): Promise<ConversationRecord | undefined> {
    const database = await this.openDatabase();
    const transaction = database.transaction(CONVERSATIONS, 'readonly');
    const conversation = await requestAsPromise(
      transaction.objectStore(CONVERSATIONS).get(id),
    );
    await transactionDone(transaction);
    return isPersistedConversation(conversation)
      ? this.hydrate(database, conversation)
      : undefined;
  }

  async list(): Promise<ConversationSummary[]> {
    const database = await this.openDatabase();
    const transaction = database.transaction(SUMMARIES, 'readonly');
    const summaries = await requestAsPromise(
      transaction.objectStore(SUMMARIES).getAll(),
    );
    await transactionDone(transaction);
    return summaries
      .filter(isConversationSummary)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  save(record: ConversationRecord): Promise<void> {
    return this.exclusive(async () => {
      const database = await this.openDatabase();
      const transaction = database.transaction(
        [CONVERSATIONS, SUMMARIES, MESSAGES, SCREENSHOTS, META],
        'readwrite',
      );
      const conversationStore = transaction.objectStore(CONVERSATIONS);
      const summaryStore = transaction.objectStore(SUMMARIES);
      const messageStore = transaction.objectStore(MESSAGES);
      const screenshotStore = transaction.objectStore(SCREENSHOTS);

      const [existingConversation, existingSummary, existingMessageKeys] =
        await Promise.all([
          requestAsPromise(conversationStore.get(record.id)),
          requestAsPromise(summaryStore.get(record.id)),
          requestAsPromise(
            messageStore.index('conversationId').getAllKeys(record.id),
          ),
        ]);
      const existingIds = new Set(existingMessageKeys.map(String));
      const newMessages = record.messages.filter(
        (message) => !existingIds.has(message.id),
      );

      const metadata: PersistedConversation = {
        id: record.id,
        title: isPersistedConversation(existingConversation)
          ? existingConversation.title
          : record.title,
        createdAt: isPersistedConversation(existingConversation)
          ? existingConversation.createdAt
          : record.createdAt,
        updatedAt: isPersistedConversation(existingConversation)
          ? [existingConversation.updatedAt, record.updatedAt].sort().at(-1)!
          : record.updatedAt,
      };
      conversationStore.put(metadata);

      for (const message of newMessages) {
        const serialized = serializeMessage(record.id, message);
        messageStore.put(serialized.message);
        if (serialized.screenshot) {
          screenshotStore.put(serialized.screenshot);
        }
      }

      const messageCount = await requestAsPromise(
        messageStore.index('conversationId').count(record.id),
      );
      const summary: ConversationSummary = {
        id: record.id,
        title: isConversationSummary(existingSummary)
          ? existingSummary.title
          : record.title,
        updatedAt: isConversationSummary(existingSummary)
          ? [existingSummary.updatedAt, record.updatedAt].sort().at(-1)!
          : record.updatedAt,
        messageCount,
      };
      summaryStore.put(summary);
      transaction.objectStore(META).put(record.id, CURRENT_CONVERSATION);
      await transactionDone(transaction);
      await this.prune(database);
    });
  }

  setCurrent(id?: string): Promise<void> {
    return this.exclusive(async () => {
      const database = await this.openDatabase();
      const transaction = database.transaction(META, 'readwrite');
      const store = transaction.objectStore(META);
      if (id) {
        store.put(id, CURRENT_CONVERSATION);
      } else {
        store.delete(CURRENT_CONVERSATION);
      }
      await transactionDone(transaction);
    });
  }

  delete(id: string): Promise<void> {
    return this.exclusive(async () => {
      const database = await this.openDatabase();
      const transaction = database.transaction(
        [CONVERSATIONS, SUMMARIES, MESSAGES, SCREENSHOTS, META],
        'readwrite',
      );
      transaction.objectStore(CONVERSATIONS).delete(id);
      transaction.objectStore(SUMMARIES).delete(id);
      await Promise.all([
        deleteByConversation(transaction.objectStore(MESSAGES), id),
        deleteByConversation(transaction.objectStore(SCREENSHOTS), id),
      ]);
      const currentId = await requestAsPromise(
        transaction.objectStore(META).get(CURRENT_CONVERSATION),
      );
      if (currentId === id) {
        transaction.objectStore(META).delete(CURRENT_CONVERSATION);
      }
      await transactionDone(transaction);
    });
  }

  private async hydrate(
    database: IDBDatabase,
    conversation: PersistedConversation,
  ): Promise<ConversationRecord> {
    const transaction = database.transaction(
      [MESSAGES, SCREENSHOTS],
      'readonly',
    );
    const [messages, screenshots] = await Promise.all([
      requestAsPromise(
        transaction
          .objectStore(MESSAGES)
          .index('conversationId')
          .getAll(conversation.id),
      ),
      requestAsPromise(
        transaction
          .objectStore(SCREENSHOTS)
          .index('conversationId')
          .getAll(conversation.id),
      ),
    ]);
    await transactionDone(transaction);
    const screenshotById = new Map(
      screenshots
        .filter(isScreenshotBlobRecord)
        .map((screenshot) => [screenshot.id, screenshot]),
    );
    const persistedMessages = messages
      .filter(isPersistedMessage)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));

    return {
      ...conversation,
      messages: await Promise.all(
        persistedMessages.map(async (message): Promise<StoredChatEntry> => {
          const stored = message.screenshot
            ? screenshotById.get(message.screenshot.id)
            : undefined;
          return {
            id: message.id,
            role: message.role,
            text: message.text,
            createdAt: message.createdAt,
            ...(message.attachments
              ? { attachments: message.attachments }
              : {}),
            ...(message.screenshot && stored
              ? {
                  screenshot: {
                    ...message.screenshot,
                    dataUrl: await blobToDataUrl(stored.blob),
                  },
                }
              : {}),
          };
        }),
      ),
    };
  }

  private async prune(database: IDBDatabase): Promise<void> {
    const summaries = await this.list();
    const obsolete = summaries.slice(MAX_CONVERSATIONS);
    if (obsolete.length === 0) {
      return;
    }
    const transaction = database.transaction(
      [CONVERSATIONS, SUMMARIES, MESSAGES, SCREENSHOTS],
      'readwrite',
    );
    for (const summary of obsolete) {
      transaction.objectStore(CONVERSATIONS).delete(summary.id);
      transaction.objectStore(SUMMARIES).delete(summary.id);
      await Promise.all([
        deleteByConversation(transaction.objectStore(MESSAGES), summary.id),
        deleteByConversation(transaction.objectStore(SCREENSHOTS), summary.id),
      ]);
    }
    await transactionDone(transaction);
  }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const globallySerialized = async (): Promise<T> => {
      if (navigator.locks) {
        return await navigator.locks.request<Promise<T>>(
          'lens-chat-history-write',
          () => operation(),
        );
      }
      return operation();
    };
    const result = this.operationTail.then(
      globallySerialized,
      globallySerialized,
    );
    this.operationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

function serializeMessage(
  conversationId: string,
  message: StoredChatEntry,
) {
  if (!message.screenshot) {
    return {
      message: {
        id: message.id,
        conversationId,
        role: message.role,
        text: message.text,
        createdAt: message.createdAt,
        ...(message.attachments
          ? { attachments: message.attachments }
          : {}),
      } satisfies PersistedMessage,
    };
  }
  const { dataUrl, ...metadata } = message.screenshot;
  return {
    message: {
      id: message.id,
      conversationId,
      role: message.role,
      text: message.text,
      createdAt: message.createdAt,
      ...(message.attachments
        ? { attachments: message.attachments }
        : {}),
      screenshot: {
        id: message.id,
        ...metadata,
      },
    } satisfies PersistedMessage,
    screenshot: {
      id: message.id,
      conversationId,
      blob: dataUrlToBlob(dataUrl),
    } satisfies ScreenshotBlobRecord,
  };
}

function migrateLegacyConversations(
  conversationStore: IDBObjectStore,
  summaryStore: IDBObjectStore,
  messageStore: IDBObjectStore,
  screenshotStore: IDBObjectStore,
) {
  const cursorRequest = conversationStore.openCursor();
  cursorRequest.onsuccess = () => {
    const cursor = cursorRequest.result;
    if (!cursor) {
      return;
    }
    const legacy = cursor.value;
    if (isLegacyConversation(legacy)) {
      cursor.update({
        id: legacy.id,
        title: legacy.title,
        createdAt: legacy.createdAt,
        updatedAt: legacy.updatedAt,
      } satisfies PersistedConversation);
      summaryStore.put({
        id: legacy.id,
        title: legacy.title,
        updatedAt: legacy.updatedAt,
        messageCount: legacy.messages.length,
      } satisfies ConversationSummary);
      for (const message of legacy.messages) {
        if (
          message.screenshot &&
          'dataUrl' in message.screenshot &&
          typeof message.screenshot.dataUrl === 'string'
        ) {
          const serialized = serializeMessage(
            legacy.id,
            message as StoredChatEntry,
          );
          messageStore.put(serialized.message);
          if (serialized.screenshot) {
            screenshotStore.put(serialized.screenshot);
          }
        } else {
          messageStore.put({
            id: message.id,
            conversationId: legacy.id,
            role: message.role,
            text: message.text,
            createdAt: message.createdAt,
            ...(message.screenshot && 'id' in message.screenshot
              ? { screenshot: message.screenshot }
              : {}),
          } satisfies PersistedMessage);
        }
      }
    }
    cursor.continue();
  };
}

function deleteByConversation(
  store: IDBObjectStore,
  conversationId: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = store.index('conversationId').openKeyCursor(conversationId);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }
      store.delete(cursor.primaryKey);
      cursor.continue();
    };
    request.onerror = () =>
      reject(request.error ?? new Error('Could not delete conversation data.'));
  });
}

function dataUrlToBlob(dataUrl: string): Blob {
  const match = /^data:(image\/(?:png|jpeg));base64,(.+)$/.exec(dataUrl);
  if (!match?.[1] || !match[2]) {
    throw new Error('Screenshot history contained an invalid image.');
  }
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: match[1] });
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunks: string[] = [];
  for (let index = 0; index < bytes.length; index += 32_768) {
    chunks.push(
      String.fromCharCode(...bytes.subarray(index, index + 32_768)),
    );
  }
  return `data:${blob.type};base64,${btoa(chunks.join(''))}`;
}

function isPersistedConversation(
  value: unknown,
): value is PersistedConversation {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Partial<PersistedConversation>;
  return (
    typeof record.id === 'string' &&
    typeof record.title === 'string' &&
    typeof record.createdAt === 'string' &&
    typeof record.updatedAt === 'string' &&
    !('messages' in record)
  );
}

function isLegacyConversation(value: unknown): value is LegacyConversation {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Partial<LegacyConversation>;
  return (
    typeof record.id === 'string' &&
    typeof record.title === 'string' &&
    typeof record.createdAt === 'string' &&
    typeof record.updatedAt === 'string' &&
    Array.isArray(record.messages)
  );
}

function isPersistedMessage(value: unknown): value is PersistedMessage {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const message = value as Partial<PersistedMessage>;
  return (
    typeof message.id === 'string' &&
    typeof message.conversationId === 'string' &&
    (message.role === 'user' || message.role === 'assistant') &&
    typeof message.text === 'string' &&
    typeof message.createdAt === 'string' &&
    (message.attachments === undefined ||
      (Array.isArray(message.attachments) &&
        message.attachments.every(isStoredFileAttachment)))
  );
}

function isStoredFileAttachment(
  value: unknown,
): value is StoredFileAttachment {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const attachment = value as Partial<StoredFileAttachment>;
  return (
    typeof attachment.name === 'string' &&
    typeof attachment.mimeType === 'string' &&
    typeof attachment.size === 'number' &&
    Number.isFinite(attachment.size) &&
    attachment.size > 0
  );
}

function isConversationSummary(
  value: unknown,
): value is ConversationSummary {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const summary = value as Partial<ConversationSummary>;
  return (
    typeof summary.id === 'string' &&
    typeof summary.title === 'string' &&
    typeof summary.updatedAt === 'string' &&
    typeof summary.messageCount === 'number'
  );
}

function isScreenshotBlobRecord(
  value: unknown,
): value is ScreenshotBlobRecord {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const screenshot = value as Partial<ScreenshotBlobRecord>;
  return (
    typeof screenshot.id === 'string' &&
    typeof screenshot.conversationId === 'string' &&
    screenshot.blob instanceof Blob
  );
}

export const historyRepository = new HistoryRepository();
