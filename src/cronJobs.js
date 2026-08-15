const cron = require('node-cron');
const { buildDailyReport } = require('./reportUtil');
const { sendReportEmail } = require('./mailer');

function startCronJobs() {
  const hour = Number(process.env.REPORT_HOUR) || 8;
  // Runs every day at HH:00 in the server's TZ (set TZ env var, e.g. Asia/Kolkata)
  const cronExpr = `0 ${hour} * * *`;

  cron.schedule(cronExpr, async () => {
    try {
      const { html } = await buildDailyReport();
      await sendReportEmail('MedStock — Daily Report', html);
      console.log(`[cron] Daily report emailed at ${new Date().toISOString()}`);
    } catch (err) {
      console.error('[cron] Failed to send daily report:', err.message);
    }
  });

  console.log(`Cron scheduled: daily report at ${hour}:00 (${process.env.TZ || 'server default timezone'}).`);
}

module.exports = { startCronJobs };
