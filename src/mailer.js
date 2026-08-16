// Sends email via Resend's HTTPS API instead of raw SMTP.
// Many free-tier hosts (including Render's free plan) block outbound SMTP ports
// as an anti-spam measure, which makes traditional nodemailer/SMTP unreliable there.
// An HTTPS-based provider sidesteps that entirely.

async function sendReportEmail(subject, html) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error('Email is not configured. Set RESEND_API_KEY in your environment.');
  }
  const from = process.env.REPORT_FROM_EMAIL || 'MedStock <onboarding@resend.dev>';
  const to = process.env.REPORT_TO_EMAIL;
  if (!to) {
    throw new Error('REPORT_TO_EMAIL is not set.');
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ from, to: [to], subject, html })
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Resend API error (${res.status}): ${body}`);
  }
}

module.exports = { sendReportEmail };
