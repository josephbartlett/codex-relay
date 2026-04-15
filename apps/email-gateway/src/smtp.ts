import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import type { EmailSmtpConfig } from "../../../packages/shared/src/config.js";
import type { EmailNotification } from "../../../packages/shared/src/types.js";

export interface EmailSender {
  send(notification: EmailNotification): Promise<void>;
}

export function createSmtpEmailSender(config: EmailSmtpConfig): EmailSender {
  if (!config.enabled) {
    throw new Error("Email SMTP notifications are disabled.");
  }

  assertSmtpConfig(config);

  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    tls: {
      rejectUnauthorized: config.tlsRejectUnauthorized
    },
    auth: config.username && config.password
      ? {
          user: config.username,
          pass: config.password
        }
      : undefined
  });

  return new NodemailerEmailSender(transport, config.from);
}

export function assertSmtpConfig(config: EmailSmtpConfig): void {
  if (!config.enabled) {
    return;
  }

  if (!config.host.trim()) {
    throw new Error("EMAIL_SMTP_HOST is required when SMTP notifications are enabled.");
  }

  if (!config.from.trim()) {
    throw new Error("EMAIL_FROM is required when SMTP notifications are enabled.");
  }

  if (config.recipients.length === 0) {
    throw new Error("EMAIL_TO must include at least one recipient when SMTP notifications are enabled.");
  }

  if (Boolean(config.username) !== Boolean(config.password)) {
    throw new Error("EMAIL_SMTP_USER and EMAIL_SMTP_PASSWORD must be configured together.");
  }
}

class NodemailerEmailSender implements EmailSender {
  constructor(
    private readonly transport: Transporter,
    private readonly from: string
  ) {}

  async send(notification: EmailNotification): Promise<void> {
    await this.transport.sendMail({
      from: this.from,
      to: notification.to,
      subject: notification.subject,
      text: notification.text
    });
  }
}
