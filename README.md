# Portfolio Reminder System

An automated email reminder system for weekly portfolio tracking updates using Gmail API and cron scheduling.

## Features

- **Automated Email Reminders**: Send scheduled reminders to portfolio owners
- **Chase Notifications**: Alert team members about pending updates
- **Review Reports**: Provide status updates to reviewers
- **Final Reports**: Compile complete weekly summary
- **Two Operating Modes**: TEST and PRODUCTION for different scheduling needs

## Setup

### Prerequisites

- Node.js (v14 or higher)
- Gmail account with API access
- Google Cloud Console project with Gmail API enabled

### Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure environment variables in `.env`:
   ```
   GOOGLE_CLIENT_ID=your_client_id
   GOOGLE_CLIENT_SECRET=your_client_secret
   REDIRECT_URI=http://localhost:3001/oauth2callback
   PORT=3001
   MODE=TEST
   ```

4. Create `reminders.json` with your team configuration:
   ```json
   [
     {
       "id": "unique-id",
       "name": "Portfolio Name",
       "owner": "Owner Name",
       "email": "owner@example.com",
       "role": "portfolio_owner",
       "status": "pending"
     }
   ]
   ```

### Gmail Authentication

1. Start the server:
   ```bash
   node server.js
   ```

2. Open browser to `http://localhost:3001`
3. Click "Connect Gmail" and authorize the application
4. Authentication tokens are saved and persist across restarts

## Operating Modes

### TEST Mode (Default)

**Use for**: Development, testing, demonstrations

Set in `.env`:
```
MODE=TEST
```

**Schedule**:
- Every 2 minutes: Owner Reminders
- Every 1 minute: Follow-up Reminders
- Every 4 minutes: Chase Notification
- Every 6 minutes: Review Notification
- Every 8 minutes: Final Report

### PRODUCTION Mode

**Use for**: Live deployment, actual weekly tracking

Set in `.env`:
```
MODE=PRODUCTION
```

**Schedule**:
- **Wednesday 9 AM**: Initial reminders to portfolio owners
- **Wed-Thu 9 AM-5 PM (hourly)**: Follow-up reminders to portfolio owners
- **Thursday 9 AM**: Chase notification to Matt & Ivan
- **Thursday 4 PM**: Review notification to Neil & Karl
- **Friday 12 PM**: Final report to Rick

## Deployment

⚠️ **IMPORTANT**: When deploying to production:

1. Update `.env` file:
   ```
   MODE=PRODUCTION
   ```

2. Verify all email addresses in `reminders.json`
3. Test authentication with Gmail
4. Restart the server to apply changes

## API Endpoints

### Authentication
- `GET /auth/url` - Get Gmail authorization URL
- `GET /oauth2callback` - OAuth callback handler
- `GET /auth/status` - Check authentication status

### Reminders
- `GET /reminders` - Get all reminders
- `GET /complete/:id` - Mark reminder as complete
- `POST /reset-reminders` - Reset all to pending

### Manual Testing
- `POST /send-test-reminder` - Send owner reminders
- `POST /send-test-chase` - Send chase notification
- `POST /send-test-review` - Send review notification
- `POST /send-test-final` - Send final report

## Project Structure

```
portfolio-reminder-system/
├── server.js           # Main application
├── public/             # Frontend files
│   └── index.html      # Admin dashboard
├── reminders.json      # Team configuration
├── tokens.json         # Gmail auth tokens (auto-generated)
├── .env               # Environment configuration
└── README.md          # This file
```

## Roles

The system supports four roles in `reminders.json`:

- **portfolio_owner**: Receives initial reminders and follow-ups
- **chase**: Receives chase notifications (Matt & Ivan)
- **reviewer**: Receives review notifications (Neil & Karl)
- **final**: Receives final report (Rick)

## Troubleshooting

### Tokens expired
- Tokens automatically refresh
- If authentication fails, re-authenticate through the web UI

### Schedules not running
- Check `MODE` setting in `.env`
- Verify server logs for schedule confirmation
- Ensure server timezone matches expected schedule times

### Emails not sending
- Verify Gmail authentication status at `/auth/status`
- Check console logs for specific error messages
- Ensure Gmail API quotas aren't exceeded

## Development

Run in development mode with nodemon:
```bash
npm install -g nodemon
nodemon server.js
```

## License

MIT
