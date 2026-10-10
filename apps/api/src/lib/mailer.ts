import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false, // STARTTLS
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

export interface MailOptions {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export async function sendMail(opts: MailOptions): Promise<void> {
  await transporter.sendMail({
    from: `"TangkayScan" <${process.env.GMAIL_USER}>`,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
    text: opts.text,
  });
}

export async function verifyConnection(): Promise<void> {
  try {
    await transporter.verify();
    console.log('[mailer] SMTP connection verified');
  } catch (err) {
    console.error('[mailer] SMTP connection failed:', err);
  }
}
