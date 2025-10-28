# Portfolio Tracker Reminder System

An automated system that monitors your investment portfolio and sends intelligent email reminders when it's time to review positions. Helps you avoid emotional decision-making by enforcing a disciplined review schedule.

## Features

- **Automated Email Reminders**: Sends Gmail reminders when portfolio positions are due for review
- **Intelligent Time Windows**: Only sends reminders during business hours (9 AM - 5 PM, Monday-Friday)
- **Flexible Scheduling**: Configure initial wait periods (e.g., 90 days) and subsequent reminder intervals (e.g., 30 days)
- **Gmail Integration**: Secure OAuth2 authentication with Gmail API
- **Test Mode**: Test the system without actually sending emails
- **Web Dashboard**: Simple web interface to monitor reminders and system status
- **JSON-based Configuration**: Easy-to-manage reminder data stored in `reminders.json`

## Setup Instructions

### Prerequisites

- Node.js (v14 or higher)
- A Google Cloud Project with Gmail API enabled
- Gmail account for sending reminders

### 1. Install Dependencies

```bash
npm install
```

### 2. Set Up Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Enable the Gmail API:
   - Navigate to "APIs & Services" > "Library"
   - Search for "Gmail API"
   - Click "Enable"
4. Create OAuth 2.0 credentials:
   - Go to "APIs & Services" > "Credentials"
   - Click "Create Credentials" > "OAuth client ID"
   - Choose "Desktop app" as application type
   - Download the credentials JSON file

### 3. Configure Environment Variables

Create a `.env` file in the project root:

```env
# Gmail OAuth2 Credentials (from Google Cloud Console)
GMAIL_CLIENT_ID=your_client_id_here
GMAIL_CLIENT_SECRET=your_client_secret_here
GMAIL_REDIRECT_URI=http://localhost:3000/oauth2callback

# Email Configuration
RECIPIENT_EMAIL=your_email@example.com

# Reminder Configuration (in days)
INITIAL_WAIT_DAYS=90
SUBSEQUENT_WAIT_DAYS=30

# Test Mode (set to true to avoid sending actual emails)
TEST_MODE=false

# Server Configuration
PORT=3000
```

### 4. Authenticate with Gmail

On first run, the system will:
1. Open a browser window for Gmail authentication
2. Ask you to authorize the application
3. Save the authentication tokens to `tokens.json`

The tokens will be automatically refreshed when needed.

### 5. Configure Portfolio Reminders

Edit `reminders.json` to add your portfolio positions:

```json
[
  {
    "ticker": "AAPL",
    "company": "Apple Inc.",
    "lastSent": null,
    "initialWaitDays": 90,
    "subsequentWaitDays": 30
  },
  {
    "ticker": "GOOGL",
    "company": "Alphabet Inc.",
    "lastSent": null,
    "initialWaitDays": 90,
    "subsequentWaitDays": 30
  }
]
```

## How to Run

### Production Mode

```bash
node server.js
```

The system will:
- Check for due reminders every hour
- Send emails only during business hours (9 AM - 5 PM, Mon-Fri)
- Update `reminders.json` with timestamps when emails are sent

### Test Mode

Set `TEST_MODE=true` in `.env` to test without sending actual emails:

```bash
TEST_MODE=true node server.js
```

In test mode:
- The system logs what emails *would* be sent
- No actual emails are sent via Gmail
- Useful for testing scheduling logic and configuration

### Access the Dashboard

Open your browser and navigate to:
```
http://localhost:3000
```

The dashboard shows:
- Current reminder status for each position
- Days until next reminder
- System configuration
- Recent activity log

## Workflow Explanation

### Initial Setup
1. Add positions to `reminders.json` with `lastSent: null`
2. System waits for the initial wait period (default: 90 days)
3. First reminder is sent after initial wait expires

### Subsequent Reminders
1. After first reminder, `lastSent` is updated with timestamp
2. System calculates next reminder based on `subsequentWaitDays` (default: 30 days)
3. Process repeats indefinitely

### Business Hours Logic
- Reminders are only sent Monday-Friday, 9 AM - 5 PM
- If a reminder is due outside business hours, it waits until the next valid time window
- Prevents weekend/night-time email disruptions

### Email Content
Each reminder email includes:
- Position ticker and company name
- Prompt to review the investment
- Encourages discipline and rational decision-making
- Simple, professional format

## File Structure

```
portfolio-reminder-system/
├── server.js           # Main application logic
├── reminders.json      # Portfolio positions and reminder state
├── tokens.json         # Gmail OAuth2 tokens (auto-generated)
├── .env               # Configuration (create this)
├── .gitignore         # Git ignore rules
├── package.json       # Node.js dependencies
└── public/
    └── index.html     # Web dashboard
```

## Security Notes

- Never commit `.env` or `tokens.json` to version control
- Keep your Google Cloud credentials secure
- Use environment variables for sensitive data
- Review OAuth2 scopes to ensure minimal permissions

## Troubleshooting

### Authentication Issues
- Delete `tokens.json` and restart to re-authenticate
- Verify Gmail API is enabled in Google Cloud Console
- Check OAuth2 credentials are correct in `.env`

### Emails Not Sending
- Verify `TEST_MODE=false` in `.env`
- Check current time is within business hours
- Review console logs for errors
- Confirm `RECIPIENT_EMAIL` is correct

### Reminders Not Triggering
- Check `reminders.json` for valid dates
- Verify wait periods are configured correctly
- System checks every hour - be patient for next check cycle

## License

MIT

## Contributing

Feel free to submit issues and enhancement requests!
