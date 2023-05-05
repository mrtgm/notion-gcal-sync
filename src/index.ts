import { Hono } from "hono";
import { getGoogleAuthToken } from "./lib/auth";
import NotionAPI from "./lib/notion";
import Config from "./config";
import GCalAPI from "./lib/gcal";
import { resolveDiffsFromGCal, resolveDiffFromGCal, resolveDiffsFromNotion } from "./lib/util";

type Bindings = {
  google_email: string;
  google_private_key: string;
  google_calendar_id: string;
  notion_token: string;
  notion_database_id: string;
  GOOGLE_SYNC_TOKEN: KVNamespace;
  NOTION_CACHE: KVNamespace;
  LAST_SYNC: KVNamespace;
};

const app = new Hono<{
  Bindings: Bindings;
}>();

app.get("/", async (c) => {
  return c.text("ok");
});

app.get("/google-calendar/watch", async (c) => {
  const scope = "https://www.googleapis.com/auth/calendar";
  const res = await getGoogleAuthToken(c.env.google_email, c.env.google_private_key, scope);
  const url = `https://www.googleapis.com/calendar/v3/calendars/${c.env.google_calendar_id}/events/watch`;

  if (res.success) {
    await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${res.data}`,
      },
      body: JSON.stringify({
        id: "notion-sync-workers",
        type: "web_hook",
        address: "https://notion-sync.morio.workers.dev/google-calendar/webhook",
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
  const syncing = await c.env.LAST_SYNC.get("lastSync");
  if (syncing === "true") {
    c.status(429);
    return c.json({
      success: false,
      message: "Lock",
    });
  }

  const notion = new NotionAPI(c.env.notion_token, c.env.notion_database_id);
  const gcal = await GCalAPI.init(c.env.google_email, c.env.google_private_key, c.env.google_calendar_id);
  const token = await c.env.GOOGLE_SYNC_TOKEN.get("syncToken");

  const events = await gcal.getExistingEvents(token);
  if (!events.items || events.items.length === 0) return c.status(404);

  const existingNotionEvent = await notion.getExistingEventById(events.items[0].id);
  const existingGCalEvent = events.items[0];

  const nextSyncToken = events.nextSyncToken;
  if (nextSyncToken) c.env.GOOGLE_SYNC_TOKEN.put("syncToken", nextSyncToken);

  const { isDeleted, isUpdated, isNew } = resolveDiffFromGCal({
    notionEvent: existingNotionEvent,
    gcalEvent: existingGCalEvent,
  });

  try {
    if (isDeleted && existingNotionEvent) {
      await notion.deleteEvent(existingNotionEvent);
    } else if (isUpdated) {
      const updatedEvent = {
        ...existingNotionEvent!,
        ...existingGCalEvent,
      };
      await notion.updateEvent(updatedEvent);
    } else if (isNew) {
      await notion.createEvent(existingGCalEvent);
    }
  } catch (e) {
    console.error(e);
    return c.status(500);
  }

  return c.json({
    success: true,
    message: "ok",
  });
});

const watchGCal = async (env: Bindings) => {
  const notion = new NotionAPI(env.notion_token, env.notion_database_id);
  const gcal = await GCalAPI.init(env.google_email, env.google_private_key, env.google_calendar_id);

  const events = await gcal.getExistingEvents();
  if (!events.items || events.items.length === 0) return console.log("WatchGCal: No events found.");

  // Webhook 経由での差分更新用に SyncToken を保存
  const nextSyncToken = events.nextSyncToken;
  if (nextSyncToken) env.GOOGLE_SYNC_TOKEN.put("syncToken", nextSyncToken);

  const existingNotionEvents = await notion.getExistingEvents();

  const { newEvents, deletedEvents, updatedEvents } = resolveDiffsFromGCal({
    notionEvents: existingNotionEvents,
    gcalEvents: events.items,
  });

  const isDeleted = deletedEvents?.length > 0;
  const isUpdated = updatedEvents?.length > 0;
  const isNew = newEvents?.length > 0;

  try {
    if (isDeleted) {
      await notion.deleteEvents(deletedEvents);
    }
    if (isUpdated) {
      await notion.updateEvents(updatedEvents);
    }
    if (isNew) {
      await notion.createEvents(newEvents);
    }
  } catch (e) {
    console.error(e);
    return;
  }

  return console.log("WatchGCal: Synced successfully.");
};

const watchNotion = async (env: Bindings) => {
  const notion = new NotionAPI(env.notion_token, env.notion_database_id);
  const gcal = await GCalAPI.init(env.google_email, env.google_private_key, env.google_calendar_id);

  const syncing = await env.LAST_SYNC.get("lastSync");
  if (syncing === "true") {
    console.error("WatchNotion: Lock");
    return;
  }
  const events = await notion.getExistingEvents();

  if (!events || events.length === 0) return console.log("WatchNotion: no events");

  const existingGCalEvents = await gcal.getExistingEvents();
  if (!existingGCalEvents.items || existingGCalEvents.items.length === 0) return;

  const { deletedEvents, newEvents, updatedEvents } = resolveDiffsFromNotion({
    notionEvents: events,
    gcalEvents: existingGCalEvents.items,
  });

  const isDeleted = deletedEvents.length > 0;
  const isUpdated = updatedEvents.length > 0;
  const isNew = newEvents.length > 0;

  await env.LAST_SYNC.put("lastSync", "true");

  try {
    if (isDeleted) {
      await gcal.deleteEvents(deletedEvents);
    }
    if (isUpdated) {
      await gcal.updateEvents(updatedEvents);
    }
    if (isNew) {
      const events = await gcal.createEvents(newEvents);
      await notion.updateEvents(events);
    }
  } catch (e) {
    console.error(e);
    return;
  }

  await env.LAST_SYNC.put("lastSync", "false");

  return console.log("WatchNotion: Synced successfully.");
};

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Bindings, ctx: ExecutionContext) {
    switch (event.cron) {
      case "*/1 * * * *":
        await watchNotion(env);
        break;
      case "0 0 * * sun":
        await watchGCal(env);
        break;
    }
  },
};
