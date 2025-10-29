// require('dotenv').config(); // Not needed on Render - uses environment variables directly
const express = require('express');
const { google } = require('googleapis');
const cors = require('cors');
const cron = require('node-cron');
const fs = require('fs').promises;
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const PORT = process.env.PORT || 3001;

// OAuth2 Setup
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.REDIRECT_URI
);

// Store tokens in memory
let tokens = null;

// Token persistence functions
const TOKENS_FILE = path.join(__dirname, 'tokens.json');

async function saveTokens(tokenData) {
  try {
    await fs.writeFile(TOKENS_FILE, JSON.stringify(tokenData, null, 2));
    console.log('[OK] Tokens saved to tokens.json');
  } catch (error) {
    console.error('Error saving tokens:', error);
  }
}

async function loadTokens() {
  try {
    const data = await fs.readFile(TOKENS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('Error loading tokens:', error);
    }
    return null;
  }
}

async function refreshTokensIfNeeded() {
  if (!tokens) return false;

  // Check if access token is expired
  if (tokens.expiry_date && tokens.expiry_date <= Date.now()) {
    try {
      console.log('Access token expired, refreshing...');
      oauth2Client.setCredentials(tokens);
      const { credentials } = await oauth2Client.refreshAccessToken();
      tokens = credentials;
      await saveTokens(tokens);
      console.log('[OK] Tokens refreshed successfully');
      return true;
    } catch (error) {
      console.error('Error refreshing tokens:', error);
      tokens = null;
      return false;
    }
  }
  return true;
}

// Generate auth URL
app.get('/auth/url', (req, res) => {
  const scopes = ['https://www.googleapis.com/auth/gmail.send'];

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent'
  });

  res.json({ url: authUrl });
});

// OAuth callback
app.get('/oauth2callback', async (req, res) => {
  const { code } = req.query;

  try {
    const { tokens: newTokens } = await oauth2Client.getToken(code);
    tokens = newTokens;
    oauth2Client.setCredentials(tokens);

    // Save tokens to file for persistence
    await saveTokens(tokens);

    res.send(`
      <html>
        <head>
          <meta charset="UTF-8">
        </head>
        <body>
          <h2>[SUCCESS] Successfully connected to Gmail!</h2>
          <p>You can close this window and return to the app.</p>
          <script>
            setTimeout(() => window.close(), 2000);
          </script>
        </body>
      </html>
    `);
  } catch (error) {
    console.error('Error getting tokens:', error);
    res.status(500).send('Authentication failed');
  }
});

// Check auth status
app.get('/auth/status', (req, res) => {
  res.json({ authenticated: !!tokens });
});

// Load reminders from file
async function loadReminders() {
  try {
    const data = await fs.readFile(path.join(__dirname, 'reminders.json'), 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error loading reminders:', error);
    return [];
  }
}

// Save reminders to file
async function saveReminders(reminders) {
  try {
    await fs.writeFile(
      path.join(__dirname, 'reminders.json'),
      JSON.stringify(reminders, null, 2)
    );
  } catch (error) {
    console.error('Error saving reminders:', error);
  }
}

// Send email via Gmail API
async function sendEmail(to, subject, body) {
  if (!tokens) {
    throw new Error('Not authenticated with Gmail');
  }

  // Override email in TEST_MODE
  const actualTo = process.env.TEST_MODE ? 'dev@digitalalpha.ai' : to;
  if (process.env.TEST_MODE && to !== actualTo) {
    console.log(`[TEST_MODE] Redirecting email from ${to} to ${actualTo}`);
  }

  oauth2Client.setCredentials(tokens);
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  const message = [
    `To: ${actualTo}`,
    'Content-Type: text/html; charset=utf-8',
    'MIME-Version: 1.0',
    `Subject: ${subject}`,
    '',
    body
  ].join('\n');

  const encodedMessage = Buffer.from(message)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  await gmail.users.messages.send({
    userId: 'me',
    requestBody: {
      raw: encodedMessage,
    },
  });
}

// Send reminder emails to portfolio owners
async function sendReminders() {
  console.log('Running scheduled reminder check...');

  const reminders = await loadReminders();
  const portfolioOwners = reminders.filter(r => r.role === 'portfolio_owner' && r.status === 'pending');

  if (portfolioOwners.length === 0) {
    console.log('No pending reminders to send');
    return;
  }

  for (const reminder of portfolioOwners) {
    try {
      const subject = `Reminder: ${reminder.name} Portfolio Update`;
      const body = `
        <html>
          <head>
            <meta charset="UTF-8">
          </head>
          <body style="font-family: Arial, sans-serif; padding: 20px;">
            <h2>Portfolio Update Reminder</h2>
            <p>Hi ${reminder.owner},</p>
            <p>This is your reminder to provide an update for <strong>${reminder.name}</strong>.</p>
            <p>
              <a href="http://localhost:${PORT}/complete/${reminder.id}"
                 style="background-color: #4CAF50; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">
                Mark as Complete
              </a>
            </p>
            <p>Thank you!</p>
          </body>
        </html>
      `;

      // Handle multiple email addresses
      const emails = Array.isArray(reminder.email) ? reminder.email : [reminder.email];
      for (const email of emails) {
        await sendEmail(email, subject, body);
        console.log(`[OK] Sent reminder to ${email} for ${reminder.name}`);
      }
    } catch (error) {
      console.error(`[ERROR] Failed to send reminder for ${reminder.name}:`, error.message);
    }
  }
}

// Send chase notification to Matt and Ivan
async function sendChaseNotification() {
  console.log('Running chase notification check...');

  const reminders = await loadReminders();
  const portfolioOwners = reminders.filter(r => r.role === 'portfolio_owner');
  const pendingOwners = portfolioOwners.filter(r => r.status === 'pending');
  const chaseTeam = reminders.filter(r => r.role === 'chase');

  if (pendingOwners.length === 0) {
    console.log('No pending updates - skipping chase notification');
    return;
  }

  const pendingList = pendingOwners.map(r => `<li><strong>${r.owner}</strong> - ${r.name}</li>`).join('');

  for (const chaser of chaseTeam) {
    try {
      const subject = `[Chase] Portfolio Updates - Pending List`;
      const body = `
        <html>
          <head>
            <meta charset="UTF-8">
          </head>
          <body style="font-family: Arial, sans-serif; padding: 20px;">
            <h2>Portfolio Updates Chase Report</h2>
            <p>Hi ${chaser.owner},</p>
            <p>The following portfolio owners haven't updated their sections yet:</p>
            <ul style="line-height: 1.8;">
              ${pendingList}
            </ul>
            <p><strong>Total pending: ${pendingOwners.length} of ${portfolioOwners.length}</strong></p>
            <p style="color: #666; font-size: 14px; margin-top: 30px;">This is an automated chase notification.</p>
          </body>
        </html>
      `;

      await sendEmail(chaser.email, subject, body);
      console.log(`[OK] Sent chase notification to ${chaser.owner}`);
    } catch (error) {
      console.error(`[ERROR] Failed to send chase notification to ${chaser.owner}:`, error.message);
    }
  }
}

// Send review notification to Neil and Karl
async function sendReviewNotification() {
  console.log('Running review notification check...');

  const reminders = await loadReminders();
  const portfolioOwners = reminders.filter(r => r.role === 'portfolio_owner');
  const completedOwners = portfolioOwners.filter(r => r.status === 'complete');
  const pendingOwners = portfolioOwners.filter(r => r.status === 'pending');
  const reviewers = reminders.filter(r => r.role === 'reviewer');

  const completedList = completedOwners.length > 0
    ? completedOwners.map(r => `<li style="color: #28a745;"><strong>${r.owner}</strong> - ${r.name}</li>`).join('')
    : '<li style="color: #999;">None yet</li>';

  const pendingList = pendingOwners.length > 0
    ? pendingOwners.map(r => `<li style="color: #dc3545;"><strong>${r.owner}</strong> - ${r.name}</li>`).join('')
    : '<li style="color: #999;">None</li>';

  for (const reviewer of reviewers) {
    try {
      const subject = `[Review] Portfolio Updates Status Report`;
      const body = `
        <html>
          <head>
            <meta charset="UTF-8">
          </head>
          <body style="font-family: Arial, sans-serif; padding: 20px;">
            <h2>Portfolio Updates Status Report</h2>
            <p>Hi ${reviewer.owner},</p>

            <h3 style="color: #28a745;">Completed Updates (${completedOwners.length}/${portfolioOwners.length}):</h3>
            <ul style="line-height: 1.8;">
              ${completedList}
            </ul>

            <h3 style="color: #dc3545;">Pending Updates (${pendingOwners.length}/${portfolioOwners.length}):</h3>
            <ul style="line-height: 1.8;">
              ${pendingList}
            </ul>

            <p style="color: #666; font-size: 14px; margin-top: 30px;">This is an automated review notification.</p>
          </body>
        </html>
      `;

      await sendEmail(reviewer.email, subject, body);
      console.log(`[OK] Sent review notification to ${reviewer.owner}`);
    } catch (error) {
      console.error(`[ERROR] Failed to send review notification to ${reviewer.owner}:`, error.message);
    }
  }
}

// Send final compiled report to Rick
async function sendFinalReport() {
  console.log('Running final report check...');

  const reminders = await loadReminders();
  const portfolioOwners = reminders.filter(r => r.role === 'portfolio_owner');
  const completedOwners = portfolioOwners.filter(r => r.status === 'complete');
  const pendingOwners = portfolioOwners.filter(r => r.status === 'pending');
  const finalRecipient = reminders.find(r => r.role === 'final');

  if (!finalRecipient) {
    console.log('No final report recipient found');
    return;
  }

  const allComplete = pendingOwners.length === 0;
  const completionRate = ((completedOwners.length / portfolioOwners.length) * 100).toFixed(0);

  const completedList = completedOwners.length > 0
    ? completedOwners.map(r => `<li style="color: #28a745;"><strong>${r.owner}</strong> - ${r.name}</li>`).join('')
    : '<li style="color: #999;">None</li>';

  const pendingList = pendingOwners.length > 0
    ? pendingOwners.map(r => `<li style="color: #dc3545;"><strong>${r.owner}</strong> - ${r.name}</li>`).join('')
    : '<li style="color: #999;">All complete!</li>';

  try {
    const subject = `Weekly Tracker Review - All Updates Complete`;

    const body = `
      <html>
        <head>
          <meta charset="UTF-8">
        </head>
        <body style="font-family: Arial, sans-serif; padding: 20px;">
          <h2>Weekly Portfolio Tracker - Final Report</h2>
          <p>Hi ${finalRecipient.owner},</p>

          <div style="background: ${allComplete ? '#d4edda' : '#fff3cd'}; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <h3 style="margin: 0;">Completion Status: ${completionRate}%</h3>
            <p style="margin: 5px 0 0 0; font-size: 18px;">
              <strong>${completedOwners.length}</strong> of <strong>${portfolioOwners.length}</strong> updates completed
            </p>
          </div>

          <p style="margin: 30px 0;">
            <a href="http://localhost:${PORT}/feedback.html"
               style="background-color: #007bff; color: white; padding: 14px 28px; text-decoration: none; border-radius: 4px; display: inline-block; font-size: 16px;">
              Add Feedback for Any Company
            </a>
          </p>

          <h3 style="color: #28a745;">Completed Updates (${completedOwners.length}):</h3>
          <ul style="line-height: 1.8;">
            ${completedList}
          </ul>

          ${pendingOwners.length > 0 ? `
          <h3 style="color: #dc3545;">Pending Updates (${pendingOwners.length}):</h3>
          <ul style="line-height: 1.8;">
            ${pendingList}
          </ul>
          ` : ''}

          <p style="color: #666; font-size: 14px; margin-top: 30px;">
            This is an automated final report for the weekly tracker update cycle.
          </p>
        </body>
      </html>
    `;

    await sendEmail(finalRecipient.email, subject, body);
    console.log(`[OK] Sent final report to ${finalRecipient.owner}`);
  } catch (error) {
    console.error(`[ERROR] Failed to send final report to ${finalRecipient.owner}:`, error.message);
  }
}

// Schedule notifications based on MODE
const MODE = process.env.MODE || 'TEST';

// Define schedules (Pacific Time converted to UTC)
const SCHEDULES = {
  TEST: {
    reminders: [
      '*/2 * * * *',  // Every 2 minutes (for testing)
      '*/3 * * * *'   // Every 3 minutes (for testing)
    ],
    chaseNotification: '*/4 * * * *',   // Every 4 minutes
    reviewNotification: '*/6 * * * *',  // Every 6 minutes
    finalReport: '*/8 * * * *'          // Every 8 minutes
  },
  PRODUCTION: {
    reminders: [
      '0 22 * * 3',  // Wednesday 3 PM PT (22:00 UTC)
      '0 22 * * 4',  // Thursday 3 PM PT (22:00 UTC)
      '0 16 * * 5',  // Friday 9 AM PT (16:00 UTC)
      '0 17 * * 5',  // Friday 10 AM PT (17:00 UTC)
      '0 18 * * 5',  // Friday 11 AM PT (18:00 UTC)
    ],
    chaseNotification: '0 19 * * 5',    // Friday 12 PM PT (19:00 UTC) - Neil/Karl review
    reviewNotification: '0 19 * * 5',   // Friday 12 PM PT (19:00 UTC) - Neil/Karl review
    finalReport: '1 0 * * 6'            // Friday 5 PM PT (00:01 UTC Saturday) - Rick final
  }
};

const schedule = SCHEDULES[MODE] || SCHEDULES.TEST;

// Schedule reminders at multiple times
schedule.reminders.forEach((cronTime, index) => {
  cron.schedule(cronTime, () => {
    if (tokens) {
      sendReminders();
    } else {
      console.log('[SKIP] Owner reminders - not authenticated');
    }
  });
});

// Chase notification
cron.schedule(schedule.chaseNotification, () => {
  if (tokens) {
    sendChaseNotification();
  } else {
    console.log('[SKIP] Chase notification - not authenticated');
  }
});

// Review notification
cron.schedule(schedule.reviewNotification, () => {
  if (tokens) {
    sendReviewNotification();
  } else {
    console.log('[SKIP] Review notification - not authenticated');
  }
});

// Final report
cron.schedule(schedule.finalReport, () => {
  if (tokens) {
    sendFinalReport();
  } else {
    console.log('[SKIP] Final report - not authenticated');
  }
});

// Manual test endpoints
app.post('/send-test-reminder', async (req, res) => {
  try {
    if (!tokens) {
      return res.status(401).json({ error: 'Not authenticated with Gmail' });
    }

    await sendReminders();
    res.json({ success: true, message: 'Owner reminders sent' });
  } catch (error) {
    console.error('Error sending test reminders:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/send-test-chase', async (req, res) => {
  try {
    if (!tokens) {
      return res.status(401).json({ error: 'Not authenticated with Gmail' });
    }

    await sendChaseNotification();
    res.json({ success: true, message: 'Chase notification sent' });
  } catch (error) {
    console.error('Error sending chase notification:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/send-test-review', async (req, res) => {
  try {
    if (!tokens) {
      return res.status(401).json({ error: 'Not authenticated with Gmail' });
    }

    await sendReviewNotification();
    res.json({ success: true, message: 'Review notification sent' });
  } catch (error) {
    console.error('Error sending review notification:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/send-test-final', async (req, res) => {
  try {
    if (!tokens) {
      return res.status(401).json({ error: 'Not authenticated with Gmail' });
    }

    await sendFinalReport();
    res.json({ success: true, message: 'Final report sent' });
  } catch (error) {
    console.error('Error sending final report:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all reminders
app.get('/reminders', async (req, res) => {
  try {
    const reminders = await loadReminders();
    res.json(reminders);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Mark reminder as complete
app.get('/complete/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const reminders = await loadReminders();
    const reminder = reminders.find(r => r.id === id);

    if (!reminder) {
      return res.status(404).send('Reminder not found');
    }

    // Mark as complete
    reminder.status = 'complete';
    await saveReminders(reminders);

    // Send notification
    try {
      if (tokens) {
        const subject = `[Complete] ${reminder.name} Update Completed`;
        const body = `
          <html>
            <head>
              <meta charset="UTF-8">
            </head>
            <body style="font-family: Arial, sans-serif; padding: 20px;">
              <h2>Update Completed</h2>
              <p><strong>${reminder.owner}</strong> has marked the update for <strong>${reminder.name}</strong> as complete.</p>
              <p>Time: ${new Date().toLocaleString()}</p>
            </body>
          </html>
        `;

        await sendEmail('dev@digitalalpha.ai', subject, body);
      }
    } catch (emailError) {
      console.error('Failed to send notification:', emailError);
    }

    // Show success page
    res.send(`
      <html>
        <head>
          <meta charset="UTF-8">
        </head>
        <body style="font-family: Arial, sans-serif; padding: 40px; text-align: center;">
          <h1 style="color: #4CAF50;">[SUCCESS] Thank you!</h1>
          <p style="font-size: 18px;">Update for <strong>${reminder.name}</strong> has been marked as complete.</p>
          <p style="color: #666;">You can close this window now.</p>
        </body>
      </html>
    `);
  } catch (error) {
    console.error('Error marking complete:', error);
    res.status(500).send('Error processing request');
  }
});

// Reset all portfolio owners to pending (for testing)
app.post('/reset-reminders', async (req, res) => {
  try {
    const reminders = await loadReminders();
    reminders.forEach(r => {
      if (r.role === 'portfolio_owner') {
        r.status = 'pending';
      }
    });
    await saveReminders(reminders);
    res.json({ success: true, message: 'All portfolio owners reset to pending' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Feedback page - now served as static HTML from /public/feedback.html
// (HTML file loads companies dynamically via /reminders endpoint)

// Submit feedback for companies
app.post('/feedback', async (req, res) => {
  try {
    const feedback = req.body; // Object with company IDs as keys, feedback text as values

    if (!feedback || Object.keys(feedback).length === 0) {
      return res.json({ success: false, error: 'No feedback provided' });
    }

    const reminders = await loadReminders();
    const companiesWithFeedback = [];
    let emailCount = 0;

    for (const [companyId, feedbackText] of Object.entries(feedback)) {
      const company = reminders.find(r => r.id === companyId && r.role === 'portfolio_owner');

      if (!company) {
        console.log(`[WARNING] Company not found: ${companyId}`);
        continue;
      }

      companiesWithFeedback.push(company.name);

      // Send feedback email to owner(s)
      const subject = `Rick's Feedback for ${company.name}`;
      const body = `
        <html>
          <head>
            <meta charset="UTF-8">
          </head>
          <body style="font-family: Arial, sans-serif; padding: 20px;">
            <h2>Feedback for ${company.name}</h2>
            <p>Hi ${company.owner},</p>

            <div style="background: #f0f8ff; border-left: 4px solid #007bff; padding: 15px; margin: 20px 0;">
              <h3 style="margin: 0 0 10px 0; color: #007bff;">Rick's Feedback:</h3>
              <p style="white-space: pre-wrap; margin: 0; line-height: 1.6;">${feedbackText}</p>
            </div>

            <p style="margin-top: 30px;">
              <a href="http://localhost:${PORT}/feedback-complete/${company.id}"
                 style="background-color: #28a745; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">
                Mark Done
              </a>
            </p>

            <p style="color: #666; font-size: 14px; margin-top: 30px;">
              This feedback is from the weekly tracker review cycle.
            </p>
          </body>
        </html>
      `;

      // Handle multiple email addresses
      const emails = Array.isArray(company.email) ? company.email : [company.email];
      for (const email of emails) {
        await sendEmail(email, subject, body);
        emailCount++;
        console.log(`[OK] Sent feedback to ${email} for ${company.name}`);
      }
    }

    res.json({
      success: true,
      count: emailCount,
      companies: companiesWithFeedback
    });
  } catch (error) {
    console.error('Error submitting feedback:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Mark feedback as complete
app.get('/feedback-complete/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const reminders = await loadReminders();
    const company = reminders.find(r => r.id === id && r.role === 'portfolio_owner');

    if (!company) {
      return res.status(404).send('Company not found');
    }

    // You could track feedback completion status if needed
    // For now, just show confirmation

    res.send(`
      <html>
        <head>
          <meta charset="UTF-8">
        </head>
        <body style="font-family: Arial, sans-serif; padding: 40px; text-align: center;">
          <h1 style="color: #28a745;">✓ Feedback Acknowledged</h1>
          <p style="font-size: 18px;">Thank you for acknowledging the feedback for <strong>${company.name}</strong>.</p>
          <p style="color: #666;">You can close this window now.</p>
        </body>
      </html>
    `);
  } catch (error) {
    console.error('Error marking feedback complete:', error);
    res.status(500).send('Error processing request');
  }
});

// Initialize tokens on startup
async function initializeServer() {
  console.log('\n🔄 Initializing server...');

  // Try to load existing tokens
  const savedTokens = await loadTokens();
  if (savedTokens) {
    tokens = savedTokens;
    oauth2Client.setCredentials(tokens);

    // Check if tokens are still valid
    const isValid = await refreshTokensIfNeeded();
    if (isValid) {
      console.log('[OK] Loaded existing Gmail authentication');
    } else {
      console.log('[WARNING] Saved tokens are invalid. Please re-authenticate.');
    }
  } else {
    console.log('[WARNING] No saved tokens found. Please authenticate with Gmail.');
  }

  console.log(`\n[SERVER] Portfolio Reminder System running on http://localhost:${PORT}`);
  console.log(`\n[MODE] Running in ${MODE} mode`);

  // Log TEST_MODE status
  if (process.env.TEST_MODE) {
    console.log('🧪 TEST MODE ACTIVE - All emails redirecting to dev@digitalalpha.ai');
  } else {
    console.log('✅ PRODUCTION MODE - Using actual email addresses');
  }

  if (MODE === 'TEST') {
    console.log(`\n[SCHEDULE] Weekly Notification Timeline (TEST Mode - Short Intervals):`);
    console.log(`  - Every 2-3 mins: Owner Reminders`);
    console.log(`  - Every 4 mins: Chase Notification to Matt & Ivan`);
    console.log(`  - Every 6 mins: Review Notification to Neil & Karl`);
    console.log(`  - Every 8 mins: Final Report to Rick\n`);
  } else {
    console.log(`\n[SCHEDULE] Weekly Notification Timeline (PRODUCTION Mode - Pacific Time):`);
    console.log(`  - Wednesday 3 PM PT: Owner Reminders`);
    console.log(`  - Thursday 3 PM PT: Owner Reminders`);
    console.log(`  - Friday 9 AM PT: Owner Reminders`);
    console.log(`  - Friday 10 AM PT: Owner Reminders`);
    console.log(`  - Friday 11 AM PT: Owner Reminders`);
    console.log(`  - Friday 12 PM PT: Review Notification to Neil & Karl`);
    console.log(`  - Friday 5 PM PT: Final Report to Rick\n`);
  }
}

app.listen(PORT, () => {
  initializeServer();
});
