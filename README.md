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
TEST_MODE=1
```

**Schedule**:
- Every 2-3 minutes: Owner Reminders
- Every 4 minutes: Chase Notification
- Every 6 minutes: Review Notification
- Every 8 minutes: Final Report

**Email Behavior**: When `TEST_MODE` is set, all emails are redirected to `dev@digitalalpha.ai` regardless of recipient.

### PRODUCTION Mode

**Use for**: Live deployment, actual weekly tracking

Set in `.env`:
```
MODE=PRODUCTION
```

**Schedule (Pacific Time)**:
- **Wednesday 3 PM PT**: Owner Reminders
- **Thursday 3 PM PT**: Owner Reminders
- **Friday 9 AM PT**: Owner Reminders
- **Friday 10 AM PT**: Owner Reminders
- **Friday 11 AM PT**: Owner Reminders
- **Friday 12 PM PT**: Review notification to Neil & Karl
- **Friday 5 PM PT**: Final report to Rick

**Email Behavior**: Emails are sent to actual recipients in `reminders.json`

## Deployment

⚠️ **IMPORTANT**: When deploying to production:

1. Update `.env` file:
   ```
   MODE=PRODUCTION
   ```
   Remove or unset `TEST_MODE` to use actual email addresses

2. Verify all email addresses in `reminders.json`
3. Test authentication with Gmail
4. Restart the server to apply changes

## Running the Server

### Testing (emails redirected to dev@digitalalpha.ai)
```bash
TEST_MODE=1 node server.js
```

### Production (actual emails)
```bash
node server.js
```

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

### Multiple Owners Per Company

Companies can have multiple owners. Use an array for the `email` field:

```json
{
  "id": "packetfabric",
  "name": "PacketFabric",
  "owner": "Matt/Shiju",
  "email": ["matt@dalphafund.com", "shiju@dalphafund.com"],
  "status": "pending",
  "role": "portfolio_owner"
}
```

**Behavior**:
- Reminders are sent to ALL emails in the array
- When ANY owner clicks "Mark as Complete", the company is marked complete
- The system tracks which owner completed it

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
