const nodemailer = require('nodemailer');

function getTransport() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    return null; // email not configured — caller should handle gracefully
  }
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 587,
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });
}

async function sendReportEmail(subject, html) {
  const transport = getTransport();
  if (!transport) {
    throw new Error('Email is not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS in your environment.');
  }
  const from = process.env.REPORT_FROM_EMAIL || process.env.SMTP_USER;
  const to = process.env.REPORT_TO_EMAIL || process.env.SMTP_USER;
  await transport.sendMail({ from, to, subject, html });
}

module.exports = { sendReportEmail };
