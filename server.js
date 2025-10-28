require('dotenv').config();
const express = require('express');
const { google } = require('googleapis');
const BoxSDK = require('box-node-sdk').default;
const cors = require('cors');
const cron = require('node-cron');
const fs = require('fs').promises;
const fsSync = require('fs');
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

// Box token store implementation
const tokenStore = {
  read: (callback) => {
    try {
      if (fsSync.existsSync('box-tokens.json')) {
        const tokens = JSON.parse(fsSync.readFileSync('box-tokens.json', 'utf8'));
        callback(null, tokens);
      } else {
        callback(null, {});
      }
    } catch (error) {
      callback(error);
    }
  },
  write: (tokens, callback) => {
    try {
      fsSync.writeFileSync('box-tokens.json', JSON.stringify(tokens, null, 2));
      callback(null);
    } catch (error) {
      callback(error);
    }
  },
  clear: (callback) => {
    try {
      if (fsSync.existsSync('box-tokens.json')) {
        fsSync.unlinkSync('box-tokens.json');
      }
      callback(null);
    } catch (error) {
      callback(error);
    }
  }
};

// Box SDK Setup
const boxSDK = new BoxSDK({
  clientID: process.env.BOX_CLIENT_ID,
  clientSecret: process.env.BOX_CLIENT_SECRET
});

// Store Box tokens in memory
let boxTokens = null;
let boxClient = null;

// Token persistence functions
const TOKENS_FILE = path.join(__dirname, 'tokens.json');
const BOX_TOKENS_FILE = path.join(__dirname, 'box-tokens.json');
const BOX_CONFIG_FILE = path.join(__dirname, 'box-config.json');

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

// Box token persistence functions
async function saveBoxTokens(tokenData) {
  try {
    await fs.writeFile(BOX_TOKENS_FILE, JSON.stringify(tokenData, null, 2));
    console.log('[OK] Box tokens saved');
  } catch (error) {
    console.error('Error saving Box tokens:', error);
  }
}

async function loadBoxTokens() {
  try {
    const data = await fs.readFile(BOX_TOKENS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('Error loading Box tokens:', error);
    }
    return null;
  }
}

async function saveBoxConfig(config) {
  try {
    await fs.writeFile(BOX_CONFIG_FILE, JSON.stringify(config, null, 2));
    console.log('[OK] Box config saved');
  } catch (error) {
    console.error('Error saving Box config:', error);
  }
}

async function loadBoxConfig() {
  try {
    const data = await fs.readFile(BOX_CONFIG_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('Error loading Box config:', error);
    }
    return null;
  }
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

// Box OAuth endpoints
app.get('/auth/box/url', (req, res) => {
  const authUrl = `https://account.box.com/api/oauth2/authorize?response_type=code&client_id=${process.env.BOX_CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.BOX_REDIRECT_URI)}`;
  res.json({ url: authUrl });
});

app.get('/auth/box/callback', async (req, res) => {
  const { code } = req.query;

  if (!code) {
    return res.status(400).send('Authorization code not provided');
  }

  try {
    const tokenResponse = await boxSDK.getTokensAuthorizationCodeGrant(code);
    boxTokens = tokenResponse;

    // Create Box client with token store
    boxClient = boxSDK.getPersistentClient(boxTokens, tokenStore);

    await saveBoxTokens(boxTokens);

    res.send(`
      <html>
        <head>
          <meta charset="UTF-8">
        </head>
        <body>
          <h2>[SUCCESS] Successfully connected to Box!</h2>
          <p>You can close this window and return to the app.</p>
          <script>
            setTimeout(() => window.close(), 2000);
          </script>
        </body>
      </html>
    `);
  } catch (error) {
    console.error('Error getting Box tokens:', error);
    res.status(500).send('Box authentication failed: ' + error.message);
  }
});

app.get('/auth/box/status', (req, res) => {
  res.json({ authenticated: !!boxTokens });
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

  oauth2Client.setCredentials(tokens);
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  const message = [
    `To: ${to}`,
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

  // Filter out owners who updated within the last 7 days
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const needsReminder = portfolioOwners.filter(reminder => {
    if (!reminder.lastUpdated) {
      return true; // Never updated, needs reminder
    }
    const lastUpdate = new Date(reminder.lastUpdated);
    return lastUpdate < sevenDaysAgo; // Updated more than 7 days ago
  });

  if (needsReminder.length === 0) {
    console.log('All portfolio owners have updated within the last 7 days');
    return;
  }

  console.log(`Sending reminders to ${needsReminder.length} of ${portfolioOwners.length} pending owners`);

  for (const reminder of needsReminder) {
    try {
      const subject = `Action Required: Update ${reminder.name} Section in Tracker`;
      const body = `
        <html>
          <head>
            <meta charset="UTF-8">
          </head>
          <body style="font-family: Arial, sans-serif; padding: 20px;">
            <h2>Portfolio Update Reminder</h2>
            <p>Hi ${reminder.owner},</p>
            <p>Please update your section for <strong>${reminder.name}</strong> in the Box tracker file.</p>
            <p style="margin: 20px 0;">
              <a href="https://app.box.com/file/2026687257037"
                 style="background-color: #0061D5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block; font-weight: bold;">
                Open Tracker in Box
              </a>
            </p>
            <p style="color: #666; font-size: 14px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e0e0e0;">
              If you have already updated and believe you are receiving this email in error,
              <a href="http://localhost:${PORT}/complete/${reminder.id}" style="color: #0061D5;">click here to mark as complete</a>.
            </p>
            <p style="color: #999; font-size: 12px; margin-top: 20px;">
              Note: Updates made in Box are automatically tracked. This link is only needed if you've already completed your update.
            </p>
          </body>
        </html>
      `;

      await sendEmail(reminder.email, subject, body);
      console.log(`[OK] Sent reminder to ${reminder.owner} for ${reminder.name}`);
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
    const subject = allComplete
      ? `[Final Report] Weekly Tracker Update - All Sections Complete`
      : `[Final Report] Weekly Tracker Update - ${completionRate}% Complete`;

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

// Define schedules
const SCHEDULES = {
  TEST: {
    ownerReminders: '*/2 * * * *',      // Every 2 minutes
    followUpReminders: '*/1 * * * *',   // Every 1 minute
    chaseNotification: '*/4 * * * *',   // Every 4 minutes
    reviewNotification: '*/6 * * * *',  // Every 6 minutes
    finalReport: '*/8 * * * *'          // Every 8 minutes
  },
  PRODUCTION: {
    ownerReminders: '0 9 * * 3',        // Wednesday 9 AM
    followUpReminders: '0 */1 9-17 * * 3-4',  // Wed-Thu 9 AM-5 PM hourly
    chaseNotification: '0 9 * * 4',     // Thursday 9 AM
    reviewNotification: '0 16 * * 4',   // Thursday 4 PM
    finalReport: '0 12 * * 5'           // Friday 12 PM
  }
};

const schedule = SCHEDULES[MODE] || SCHEDULES.TEST;

// Stage 1: Wednesday 9 AM - Initial reminders to portfolio owners
cron.schedule(schedule.ownerReminders, () => {
  if (tokens) {
    sendReminders();
  } else {
    console.log('[SKIP] Owner reminders - not authenticated');
  }
});

// Stage 1.5: Wednesday-Thursday 9 AM-5 PM - Follow-up reminders every hour
cron.schedule(schedule.followUpReminders, () => {
  if (tokens) {
    sendReminders();
  } else {
    console.log('[SKIP] Follow-up reminders - not authenticated');
  }
});

// Stage 2: Thursday 9 AM - Chase notification to Matt and Ivan
cron.schedule(schedule.chaseNotification, () => {
  if (tokens) {
    sendChaseNotification();
  } else {
    console.log('[SKIP] Chase notification - not authenticated');
  }
});

// Stage 3: Thursday 4 PM - Review notification to Neil and Karl
cron.schedule(schedule.reviewNotification, () => {
  if (tokens) {
    sendReviewNotification();
  } else {
    console.log('[SKIP] Review notification - not authenticated');
  }
});

// Stage 4: Friday 12 PM - Final report to Rick
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
    reminder.lastUpdated = new Date().toISOString();
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

// Reset week - clear status and lastUpdated for all portfolio owners
app.post('/reset-week', async (req, res) => {
  try {
    const reminders = await loadReminders();
    let count = 0;
    reminders.forEach(r => {
      if (r.role === 'portfolio_owner') {
        r.status = 'pending';
        r.lastUpdated = null;
        delete r.completedAt;
        delete r.completedBy;
        delete r.completedVia;
        count++;
      }
    });
    await saveReminders(reminders);
    res.json({
      success: true,
      message: `Reset ${count} portfolio owners for new week`,
      count
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Box file monitoring endpoints
app.post('/box/set-file', async (req, res) => {
  try {
    const { fileId } = req.body;

    if (!fileId) {
      return res.status(400).json({ error: 'File ID is required' });
    }

    if (!boxClient) {
      return res.status(401).json({ error: 'Not authenticated with Box' });
    }

    // Test access to the file
    try {
      const file = await boxClient.files.get(fileId);
      console.log('[OK] Box file access verified:', file.name);
    } catch (error) {
      console.error('Error accessing Box file:', error);
      return res.status(400).json({ error: 'Cannot access file. Check file ID and permissions.' });
    }

    // Save file ID and initial state
    const config = {
      fileId,
      lastChecked: new Date().toISOString(),
      lastModified: null
    };

    await saveBoxConfig(config);
    res.json({ success: true, message: 'Box file monitoring configured', fileId });
  } catch (error) {
    console.error('Error setting Box file:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/box/config', async (req, res) => {
  try {
    const config = await loadBoxConfig();
    res.json(config || { fileId: null });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Check Box file for changes
async function checkBoxFileChanges() {
  if (!boxClient) {
    console.log('[SKIP] Box file check - not authenticated');
    return;
  }

  const config = await loadBoxConfig();
  if (!config || !config.fileId) {
    console.log('[SKIP] Box file check - no file configured');
    return;
  }

  try {
    const file = await boxClient.files.get(config.fileId, { fields: 'modified_at,modified_by,name' });
    const currentModified = file.modified_at;

    console.log(`[BOX] Checking file: ${file.name}`);
    console.log(`[BOX] Last modified: ${currentModified}`);

    // Check if file was modified since last check
    if (config.lastModified && currentModified !== config.lastModified) {
      console.log(`[BOX] File changed! Previous: ${config.lastModified}, Current: ${currentModified}`);

      const modifier = file.modified_by ? file.modified_by.name : 'Unknown';
      console.log(`[BOX] Modified by: ${modifier}`);

      // Find matching reminder by name and mark as complete
      const reminders = await loadReminders();
      let updated = false;

      for (const reminder of reminders) {
        if (reminder.role === 'portfolio_owner' && reminder.status === 'pending') {
          // Check if the modifier name matches the owner name (case-insensitive)
          if (modifier.toLowerCase().includes(reminder.owner.toLowerCase()) ||
              reminder.owner.toLowerCase().includes(modifier.toLowerCase())) {
            const timestamp = new Date().toISOString();
            reminder.status = 'complete';
            reminder.completedAt = timestamp;
            reminder.completedBy = modifier;
            reminder.completedVia = 'box';
            reminder.lastUpdated = timestamp;
            console.log(`[OK] Auto-completed reminder for ${reminder.owner} (${reminder.name})`);
            updated = true;

            // Send notification
            try {
              if (tokens) {
                const subject = `[Auto-Complete] ${reminder.name} Update Completed via Box`;
                const body = `
                  <html>
                    <head>
                      <meta charset="UTF-8">
                    </head>
                    <body style="font-family: Arial, sans-serif; padding: 20px;">
                      <h2>Update Auto-Completed</h2>
                      <p><strong>${reminder.owner}</strong> has updated their section for <strong>${reminder.name}</strong> in Box.</p>
                      <p><strong>Modified by:</strong> ${modifier}</p>
                      <p><strong>Time:</strong> ${new Date(currentModified).toLocaleString()}</p>
                      <p style="color: #666; font-size: 14px; margin-top: 20px;">This update was automatically detected via Box file monitoring.</p>
                    </body>
                  </html>
                `;
                await sendEmail('dev@digitalalpha.ai', subject, body);
              }
            } catch (emailError) {
              console.error('Failed to send notification:', emailError);
            }
          }
        }
      }

      if (updated) {
        await saveReminders(reminders);
      } else {
        console.log(`[INFO] File modified by ${modifier}, but no matching pending reminder found`);
      }
    } else if (!config.lastModified) {
      console.log('[BOX] Initial file state captured');
    } else {
      console.log('[BOX] No changes detected');
    }

    // Update config with latest check time and modification time
    config.lastChecked = new Date().toISOString();
    config.lastModified = currentModified;
    await saveBoxConfig(config);

  } catch (error) {
    console.error('[ERROR] Box file check failed:', error.message);
  }
}

// Schedule Box file monitoring (every 5 minutes)
cron.schedule('*/5 * * * *', () => {
  checkBoxFileChanges();
});

// Initialize tokens on startup
async function initializeServer() {
  console.log('\n🔄 Initializing server...');

  // Try to load existing Gmail tokens
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

  // Try to load existing Box tokens
  const savedBoxTokens = await loadBoxTokens();
  if (savedBoxTokens) {
    boxTokens = savedBoxTokens;
    boxClient = boxSDK.getPersistentClient(boxTokens, tokenStore);
    console.log('[OK] Loaded existing Box authentication');
  } else {
    console.log('[WARNING] No Box tokens found. Please authenticate with Box.');
  }

  // Load Box config if available
  const boxConfig = await loadBoxConfig();
  if (boxConfig && boxConfig.fileId) {
    console.log(`[OK] Box monitoring configured for file ID: ${boxConfig.fileId}`);
  }

  console.log(`\n[SERVER] Portfolio Reminder System running on http://localhost:${PORT}`);
  console.log(`\n[MODE] Running in ${MODE} mode`);

  if (MODE === 'TEST') {
    console.log(`\n[SCHEDULE] Weekly Notification Timeline (TEST Mode - Short Intervals):`);
    console.log(`  - Every 2 mins: Owner Reminders (Wed 9 AM in production)`);
    console.log(`  - Every 1 min: Follow-up Reminders (Wed-Thu 9 AM-5 PM in production)`);
    console.log(`  - Every 4 mins: Chase Notification to Matt & Ivan (Thu 9 AM in production)`);
    console.log(`  - Every 6 mins: Review Notification to Neil & Karl (Thu 4 PM in production)`);
    console.log(`  - Every 8 mins: Final Report to Rick (Fri 12 PM in production)\n`);
  } else {
    console.log(`\n[SCHEDULE] Weekly Notification Timeline (PRODUCTION Mode):`);
    console.log(`  - Wednesday 9 AM: Owner Reminders`);
    console.log(`  - Wed-Thu 9 AM-5 PM (hourly): Follow-up Reminders`);
    console.log(`  - Thursday 9 AM: Chase Notification to Matt & Ivan`);
    console.log(`  - Thursday 4 PM: Review Notification to Neil & Karl`);
    console.log(`  - Friday 12 PM: Final Report to Rick\n`);
  }
}

app.listen(PORT, () => {
  initializeServer();
});
