/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `wrangler dev src/index.ts` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `wrangler publish src/index.ts --name my-worker` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */
import { Env, Hono, HonoRequest } from "hono";
import { getGoogleAuthToken } from "./lib/auth";
import { calendar_v3 } from "@googleapis/calendar";
import { Client } from "@notionhq/client";
import NotionAPI from "./lib/notion";
import GCalAPI from "./lib/gcal";
import { ExistingEvents, Event } from "./type";
import { resolveDiff, resolveDiffs } from "./lib/util";

type Bindings = {
  google_email: string;
  google_private_key: string;
  google_calendar_id: string;
  notion_token: string;
  notion_database_id: string;
  GOOGLE_SYNC_TOKEN: KVNamespace;
};

const app = new Hono<{
  Bindings: Bindings;
}>();

app.get("/google-calendar/watch", async (c) => {
  const scope = "https://www.googleapis.com/auth/calendar";
  const res = await getGoogleAuthToken(c.env.google_email, c.env.google_private_key, scope);
  const url = `https://www.googleapis.com/calendar/v3/calendars/${c.env.google_calendar_id}/events/watch`;

  if (res.success) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${res.data}`,
      },
      body: JSON.stringify({
        id: "notion-sync",
        type: "web_hook",
        address: "https://remove-hobby-combining-willing.trycloudflare.com/google-calendar/webhook",
      }),
    });
    return c.json({
      success: true,
      message: "ok",
    });
  } else {
    return c.json({
      success: false,
      message: "failed",
    });
  }
});

app.post("/google-calendar/webhook", async (c) => {
  const notion = new NotionAPI(c.env.notion_token, c.env.notion_database_id);
  const gcal = await GCalAPI.init(c.env.google_email, c.env.google_private_key, c.env.google_calendar_id);
  const token = await c.env.GOOGLE_SYNC_TOKEN.get("syncToken");

  const events = await gcal.getExistingEvents(token);
  if (!events.items || events.items.length === 0) return;

  const nextSyncToken = events.nextSyncToken;
  if (nextSyncToken) c.env.GOOGLE_SYNC_TOKEN.put("syncToken", nextSyncToken);

  const existingNotionEvent = (await notion.getExistingEvents())[0];
  const existingGCalEvent = events.items[0];

  const { isDeleted, isUpdated, isNew } = resolveDiff({
    notionEvent: existingNotionEvent,
    gcalEvent: existingGCalEvent,
  });

  if (isDeleted) {
    await notion.deleteEvent(existingNotionEvent);
  }

  if (isUpdated) {
    const updatedEvent = {
      ...existingNotionEvent,
      ...existingGCalEvent,
    };
    await notion.updateEvent(updatedEvent);
  }

  if (isNew) {
    await notion.createEvent(existingGCalEvent);
  }

  return c.json({
    success: true,
    message: "ok",
  });
});

// TODO: POST に変更
app.get("/", async (c) => {
  const notion = new NotionAPI(c.env.notion_token, c.env.notion_database_id);
  const gcal = await GCalAPI.init(c.env.google_email, c.env.google_private_key, c.env.google_calendar_id);

  const events = await gcal.getExistingEvents();
  if (!events.items || events.items.length === 0) return;

  // Webhook 経由での差分更新用に SyncToken を保存
  const nextSyncToken = events.nextSyncToken;
  if (nextSyncToken) c.env.GOOGLE_SYNC_TOKEN.put("syncToken", nextSyncToken);

  const existingNotionEvents = await notion.getExistingEvents();

  const { newEvents, deletedEvents, updatedEvents } = resolveDiffs({
    notionEvents: existingNotionEvents,
    gcalEvents: events.items,
  });

  if (deletedEvents.length) {
    await notion.deleteEvents(deletedEvents);
  }

  if (updatedEvents.length) {
    await notion.updateEvents(updatedEvents);
  }

  if (newEvents.length) {
    await notion.createEvents(newEvents);
  }

  return c.text(JSON.stringify(events));
});

export default app;
