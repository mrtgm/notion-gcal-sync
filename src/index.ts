import { Hono } from 'hono';
import { getGoogleAuthToken } from './lib/auth';
import NotionAPI from './lib/notion';
import GCalAPI from './lib/gcal';
import { Event } from './type';

type Bindings = {
  google_email: string;
  google_private_key: string;
  google_calendar_id: string;
  notion_token: string;
  notion_database_id: string;
  GOOGLE_SYNC_TOKEN: KVNamespace;
  NOTION_CACHE: KVNamespace;
};

const app = new Hono<{
  Bindings: Bindings;
}>();

app.get('/', async (c) => {
  return c.text('ok');
});

/**
 * @summary Watch Google Calendar and Sync with Notion
 * @desc
 * 1. Fetch Existing Events from Google Calendar
 * 2. Get the cached events from KV
 * 3. Compare the two
 * 4. If there are new events, create new pages in Notion
 * 5. If there are deleted events, delete the pages in Notion
 * 6. If there are updated events, update the pages in Notion
 * @param env Bindings
 * @returns void
 */

const watchGCal = async (env: Bindings) => {
  console.log('------ Start Sync ------');
  console.log('GCal 👉 Notion: Start', new Date().toLocaleString());
  const notion = new NotionAPI(env.notion_token, env.notion_database_id);
  const gcal = await GCalAPI.init(env.google_email, env.google_private_key, env.google_calendar_id);

  const events = await gcal.getExistingEvents();
  console.log('GCal 👉 Notion: Incoming Events', events);

  const sortedEvents = events.sort((a, b) => {
    if (a.start > b.start) return -1;
    else return 1;
  });

  const cache = await env.NOTION_CACHE.get('cache');
  const cachedEvents: Event[] = cache ? JSON.parse(cache) : [];
  console.log('GCal 👉 Notion: Cached Events', cachedEvents);

  if (!cache) {
    await env.NOTION_CACHE.put('cache', JSON.stringify(sortedEvents));
    return console.log('GCal 👉 Notion: Cache Does Not Exist, Created New Cache');
  } else {
    await env.NOTION_CACHE.put('cache', JSON.stringify(sortedEvents));
    console.log('GCal 👉 Notion: Updated Cache');
  }

  if (cache === JSON.stringify(sortedEvents)) {
    console.log('GCal 👉 Notion: No Changes');
    return console.log('------ End Sync ------');
  }

  const newEvents = sortedEvents.filter((event) => {
    return !cachedEvents.some((cachedEvent) => cachedEvent.id === event.id);
  });

  const deletedEvents = cachedEvents.filter((cachedEvent) => {
    return !sortedEvents.some((event) => event.id === cachedEvent.id);
  });

  const updatedEvents = sortedEvents.filter((event) => {
    return cachedEvents.some((cachedEvent) => {
      return (
        event.id === cachedEvent.id &&
        (event.title !== cachedEvent.title ||
          event.tag !== cachedEvent.tag ||
          event.start !== cachedEvent.start ||
          event.end !== cachedEvent.end)
      );
    });
  });

  const isDeleted = deletedEvents?.length > 0;
  const isUpdated = updatedEvents?.length > 0;
  const isNew = newEvents?.length > 0;

  console.log('GCal 👉 Notion: Diff Found', 'new:', newEvents, 'delete:', deletedEvents, 'update:', updatedEvents);

  try {
    if (isDeleted) {
      await notion.deleteEvents(deletedEvents);
    }
    if (isUpdated) {
      await notion.updateEvents(updatedEvents);
    }
    if (isNew) {
      const events = await notion.createEvents(newEvents); // At this point, the new event on Google Calendar has no pageId
      await gcal.updateEvents(events); // Update the event on Google Calendar with the pageId
    }
  } catch (e) {
    console.error('GCal 👉 Notion: Failed 💀', e);
    return;
  }

  console.log('GCal 👉 Notion: Synced successfully ✨');
  return console.log('------ End Sync ------');
};

/**
 * @summary Watch Notion and Sync with Google Calendar
 * @desc
 * 1. Fetch Existing Events from Notion
 * 2. Get the cached events from KV
 * 3. Compare the two
 * 4. If there are new events, create new events in Google Calendar
 * 5. If there are deleted events, delete the events in Google Calendar
 * 6. If there are updated events, update the events in Google Calendar
 * @param env Bindings
 * @returns void
 */

const watchNotion = async (env: Bindings) => {
  console.log('------ Start Sync ------');
  console.log('Notion 👉 GCal: Start', new Date().toLocaleString());

  const notion = new NotionAPI(env.notion_token, env.notion_database_id);
  const gcal = await GCalAPI.init(env.google_email, env.google_private_key, env.google_calendar_id);

  const events = await notion.getExistingEvents();
  console.log('Notion 👉 GCal: Incoming Events', events);

  const sortedEvents = events.sort((a, b) => {
    if (a.start < b.start) return -1;
    else return 1;
  });

  const cache = await env.NOTION_CACHE.get('cache');
  const cachedEvents: Event[] = cache ? JSON.parse(cache) : [];
  console.log('Notion 👉 GCal: Cached Events', cachedEvents);

  if (!cache) {
    await env.NOTION_CACHE.put('cache', JSON.stringify(sortedEvents));
    return console.log('Notion 👉 GCal: Cache Does Not Exist, Created New Cache');
  } else {
    await env.NOTION_CACHE.put('cache', JSON.stringify(sortedEvents));
    console.log('Notion 👉 GCal: Updated Cache');
  }

  if (cache === JSON.stringify(sortedEvents)) {
    console.log('Notion 👉 GCal: No Changes');
    return console.log('------ End Sync ------');
  }

  const newEvents = sortedEvents.filter((event) => {
    return !cachedEvents.find((cachedEvent) => cachedEvent.id === event.id);
  });

  const deletedEvents = cachedEvents.filter((cachedEvent) => {
    return !sortedEvents.find((event) => event.id === cachedEvent.id);
  });

  const updatedEvents = sortedEvents.filter((event) => {
    return cachedEvents.some((cachedEvent) => {
      return (
        event.id === cachedEvent.id &&
        (event.title !== cachedEvent.title ||
          event.tag !== cachedEvent.tag ||
          event.start !== cachedEvent.start ||
          event.end !== cachedEvent.end)
      );
    });
  });

  console.log('Notion 👉 GCal: Diff Found', 'new:', newEvents, 'delete:', deletedEvents, 'update:', updatedEvents);

  const isDeleted = deletedEvents.length > 0;
  const isUpdated = updatedEvents.length > 0;
  const isNew = newEvents.length > 0;

  try {
    if (isDeleted) {
      await gcal.deleteEvents(deletedEvents);
    }
    if (isUpdated) {
      await gcal.updateEvents(updatedEvents);
    }
    if (isNew) {
      const events = await gcal.createEvents(newEvents); // At this point, the new event on Notion has no eventId
      await notion.updateEvents(events); // Update the event on Notion with the eventId
    }
  } catch (e) {
    console.error('Notion 👉 GCal: Failed 💀', e);
    return;
  }

  console.log('Notion 👉 GCal: Synced successfully ✨');
  return console.log('------ Synced successfully ------');
};

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Bindings, ctx: ExecutionContext) {
    switch (event.cron) {
      case '*/1 * * * *':
        console.log('🔥🔥🔥 #1: Sync Notion 👉 Google Calendar 🔥🔥🔥');
        await watchNotion(env);
        console.log('🔥🔥🔥 #2: Sync Google Calendar 👉 Notion 🔥🔥🔥');
        await watchGCal(env);
        break;
    }
  },
};
