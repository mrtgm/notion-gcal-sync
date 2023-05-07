# notion-gcal-sync

A simple script to do 2 way-sync between Notion and Google Calendar using Cloudflare Workers.

## Prerequisites

- Google Calendar
- Notion
- Cloudflare Workers
  - KV
  - Trigger

## Usage

1. Create a new Google Calendar.
2. Create a new Notion database with the following properties:
   - `Name`: title
   - `Date`: start / end date with time
   - `Event Id`: rich text
   - `Tag`: select
   - `Milestone`: checkbox
3. Create a new integration in Notion and get the token. See: [Notion doc](https://developers.notion.com/docs/create-a-notion-integration#step-1-create-an-integration)
4. Create a new service account in Google Cloud Console and download the JSON key.
5. In Google Calendar, go to `Settings and sharing` -> `Share with specific people` and add the service account email with `Make changes to events` permission.
6. Create a new Cloudflare Worker, and set the following secrets:
   - `notion_token`: Notion integration token
   - `notion_database_id`: Notion database ID
   - `google_calendar_id`: Google Calendar ID
   - `google_private_key`: Google service account private key
   - `google_client_email`: Google service account email
7. Deploy the worker.

## Tag

The title of the event in Google Calendar enclosed in `[]` will be treated as tag in Notion. For example, `[Me]` will be treated as `Me`.
If the event has tag `Me`, the event will be created as private.

## Milestone

If the event in Notion has `Milestone` checked, the event will be created as all day event in Google Calendar.

## Caveats

- The events with attendees are not supported.
- Date and time are formatted in UTC.

## Local Development

Environment variables for local development can be set in a `.dev.vars` file. See: [Cloudflare doc](https://developers.cloudflare.com/workers/platform/environment-variables/#secrets-in-development)

```bash
# Install dependencies
npm install

# Run the worker locally
npm run start

# Deploy the worker
npm run deploy

# Test cron job locally
open "http://localhost:8787/__scheduled?cron=*/1+*+*+*+*"
```

## License

MIT
