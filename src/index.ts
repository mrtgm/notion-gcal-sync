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
        id: "hono",
        type: "web_hook",
        address: "https://less-heater-suddenly-ge.trycloudflare.com/google-calendar/webhook",
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

  // 削除 or 更新
  const nextSyncToken = events.nextSyncToken;
  if (nextSyncToken) c.env.GOOGLE_SYNC_TOKEN.put("syncToken", nextSyncToken);

  return c.json({
    success: true,
    message: "ok",
  });
});

const resolveDiff = ({
  notionEvents,
  gcalEvents,
}: {
  notionEvents: {
    id: string;
    eventId: string;
  }[];
  gcalEvents: calendar_v3.Schema$Events;
}) => {
  // Google Calendar に存在するが Notion に存在しないイベント
  const newEvents = gcalEvents.items?.filter((event) => {
    if (!event.id) return false;
    return !notionEvents.some((v) => v?.eventId === event.id);
  });

  // Google Calendar に存在するが Notion に存在しないイベント
  const deletedEvents = notionEvents.filter((v) => {
    return !gcalEvents.items?.some((event) => event?.id === v?.eventId);
  });

  // Notion に存在するが Google Calendar に存在しないイベント
  const updatedEvents = gcalEvents.items?.reduce((acc, event) => {
    if (!event.id) return [];
    const index = notionEvents.findIndex((v) => v?.eventId === event.id);
    if (index < 0) return acc;

    return [
      ...acc,
      {
        ...event,
        pageId: notionEvents[index]?.id,
      },
    ];
  }, [] as ExistingEvents[]);

  return {
    newEvents,
    deletedEvents,
    updatedEvents,
  };
};

app.get("/", async (c) => {
  // TODO: POST に変更
  const notion = new NotionAPI(c.env.notion_token, c.env.notion_database_id);
  const gcal = await GCalAPI.init(c.env.google_email, c.env.google_private_key, c.env.google_calendar_id);

  const events = await gcal.getExistingEvents();
  if (!events.items || events.items.length === 0) return;

  // Webhook 経由での差分更新用に SyncToken を保存
  const nextSyncToken = events.nextSyncToken;
  if (nextSyncToken) c.env.GOOGLE_SYNC_TOKEN.put("syncToken", nextSyncToken);

  const existingNotionEvents = await notion.getExistingEvents();

  // Google Calendar に存在するが Notion に存在しないイベント
  const newEvents = events.items.filter((event) => {
    if (!event.id) return false;
    return !existingNotionEvents.some((v) => v?.id === event.id);
  });

  // Notion に存在するが Google Calendar に存在しないイベント
  const deletedEvents = existingNotionEvents.filter((v) => {
    if (!events.items || events.items.length === 0) return [];
    return !events.items.some((event) => event?.id === v?.id);
  });

  // Google Calendar に存在し、Notion にも存在するイベント
  const updatedEvents = events.items.reduce((acc, event) => {
    if (!event.id) return [];
    const index = existingNotionEvents.findIndex((v) => v?.id === event.id);
    if (index < 0) return acc;

    return [
      ...acc,
      {
        ...event,
        pageId: existingNotionEvents[index]?.notionPageId,
      },
    ];
  }, [] as Event[]);

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
