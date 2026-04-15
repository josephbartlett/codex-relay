import { ImapFlow } from "imapflow";
import type { EmailImapConfig } from "../../../packages/shared/src/config.js";
import type { InboundEmailMessage } from "./commands.js";
import { simpleParser } from "mailparser";

export interface MailboxMessageRef {
  uid: number;
  messageId: string;
}

export interface EmailMailboxClient {
  fetchUnread(maxMessages: number): Promise<Array<InboundEmailMessage & MailboxMessageRef>>;
  markProcessed(message: MailboxMessageRef): Promise<void>;
  close(): Promise<void>;
}

export type EmailMailboxClientFactory = () => Promise<EmailMailboxClient>;

export function createImapMailboxClientFactory(config: EmailImapConfig): EmailMailboxClientFactory {
  return async () => {
    const client = new ImapFlow({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: {
        user: config.username ?? "",
        pass: config.password ?? ""
      },
      tls: {
        rejectUnauthorized: config.tlsRejectUnauthorized
      },
      logger: false
    });

    await client.connect();
    return new ImapEmailMailboxClient(client, config);
  };
}

class ImapEmailMailboxClient implements EmailMailboxClient {
  constructor(
    private readonly client: ImapFlow,
    private readonly config: EmailImapConfig
  ) {}

  async fetchUnread(maxMessages: number): Promise<Array<InboundEmailMessage & MailboxMessageRef>> {
    const lock = await this.client.getMailboxLock(this.config.mailbox);

    try {
      const unseen = await this.client.search({ seen: false }, { uid: true });

      if (!unseen || unseen.length === 0) {
        return [];
      }

      const uids = unseen.slice(-maxMessages);
      const messages: Array<InboundEmailMessage & MailboxMessageRef> = [];

      for await (const message of this.client.fetch(
        uids,
        {
          uid: true,
          envelope: true,
          source: { maxLength: this.config.maxBytes },
          threadId: true,
          internalDate: true
        },
        { uid: true }
      )) {
        if (!message.source) {
          continue;
        }

        const parsed = await simpleParser(message.source, {
          skipHtmlToText: true,
          skipTextToHtml: true,
          skipTextLinks: true
        });
        const messageId = parsed.messageId || message.envelope?.messageId || `${this.config.mailbox}:${message.uid}`;
        const from = parsed.from?.text || formatEnvelopeFrom(message.envelope?.from) || "";

        messages.push({
          uid: message.uid,
          messageId,
          threadId: parsed.inReplyTo || message.threadId || messageId,
          from,
          subject: parsed.subject || message.envelope?.subject,
          text: parsed.text ?? "",
          receivedAt: normalizeDate(parsed.date ?? message.internalDate)
        });
      }

      return messages;
    } finally {
      lock.release();
    }
  }

  async markProcessed(message: MailboxMessageRef): Promise<void> {
    const lock = await this.client.getMailboxLock(this.config.mailbox);

    try {
      await this.client.messageFlagsAdd([message.uid], ["\\Seen"], { uid: true });
    } finally {
      lock.release();
    }
  }

  async close(): Promise<void> {
    await this.client.logout();
  }
}

function formatEnvelopeFrom(addresses: Array<{ name?: string; address?: string }> | undefined): string | undefined {
  const first = addresses?.find((address) => address.address);

  if (!first?.address) {
    return undefined;
  }

  return first.name ? `${first.name} <${first.address}>` : first.address;
}

function normalizeDate(value: Date | string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
