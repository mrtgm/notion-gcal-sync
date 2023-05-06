import { Hono } from 'hono';
import { getGoogleAuthToken } from './lib/auth';
import NotionAPI from './lib/notion';
import Config from './config';
import GCalAPI from './lib/gcal';
import { resolveDiffsFromGCal, resolveDiffFromGCal, resolveDiffsFromNotion, sleep } from './lib/util';
import { Event } from './type';

type Bindings = {
  google_email: string;
  google_private_key: string;
  google_calendar_id: string;
  notion_token: string;
  notion_database_id: string;
  GOOGLE_SYNC_TOKEN: KVNamespace;
  NOTION_CACHE: KVNamespace;
  GCAL_CACHE: KVNamespace;
  LAST_SYNC: KVNamespace;
};

const app = new Hono<{
  Bindings: Bindings;
}>();

app.get('/', async (c) => {
  return c.text('ok');
});

app.get('/google-calendar/watch', async (c) => {
  const scope = 'https://www.googleapis.com/auth/calendar';
  const res = await getGoogleAuthToken(c.env.google_email, c.env.google_private_key, scope);
  const url = `https://www.googleapis.com/calendar/v3/calendars/${c.env.google_calendar_id}/events/watch`;
  const id = crypto.randomUUID();

  if (res.success) {
    await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${res.data}`,
      },
      body: JSON.stringify({
        id: id,
        type: 'web_hook',
        address: 'https://contributions-protected-ciao-trying.trycloudflare.com/google-calendar/webhook',
      }),
    });
    return c.json({
      success: true,
      message: 'ok',
    });
  } else {
    return c.json({
      success: false,
      message: 'failed',
    });
  }
});

const watchGCal = async (env: Bindings) => {
  console.log('------ Start Sync ------\nGCal 👉 Notion', new Date().toLocaleString());
  const notion = new NotionAPI(env.notion_token, env.notion_database_id);
  const gcal = await GCalAPI.init(env.google_email, env.google_private_key, env.google_calendar_id);

  const events = await gcal.getExistingEvents();
  console.log('GCal 👉 Notion: Incoming Events', events);

  const sortedEvents = events.items.sort((a, b) => {
    if (a.start > b.start) return -1;
    else return 1;
  });

  const cache = await env.NOTION_CACHE.get('cache');

  if (!cache) {
    await env.NOTION_CACHE.put('cache', JSON.stringify(sortedEvents));
    return console.log('GCal 👉 Notion: Cache Does Not Exist. Created New Cache.');
  } else {
    await env.NOTION_CACHE.put('cache', JSON.stringify(sortedEvents));
    console.log('GCal 👉 Notion: Created New Cache.');
  }

  if (cache === JSON.stringify(sortedEvents)) {
    return console.log('GCal 👉 Notion: No Changes.');
  }

  const cachedEvents: Event[] = cache ? JSON.parse(cache) : [];
  console.log('GCal 👉 Notion: Cached Events', cachedEvents);

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

  console.log('GCal 👉 Notion', 'new:', newEvents, 'delete:', deletedEvents, 'update:', updatedEvents);

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
    console.error('GCal 👉 Notion: Failed!!!', e);
    return;
  }

  return console.log('------ Synced successfully ------');
};

const watchNotion = async (env: Bindings) => {
  console.log('------ Start Sync ------\nNotion 👉 GCal:', new Date().toLocaleString());

  const notion = new NotionAPI(env.notion_token, env.notion_database_id);
  const gcal = await GCalAPI.init(env.google_email, env.google_private_key, env.google_calendar_id);

  const syncing = await env.LAST_SYNC.get('lastSync');
  if (syncing === 'true') {
    console.error('Notion 👉 GCal: Operation Locked');
    return;
  }
  const events = await notion.getExistingEvents();
  console.log('Notion 👉 GCal: Incoming Events', events);

  const sortedEvents = events.sort((a, b) => {
    if (a.start < b.start) return -1;
    else return 1;
  });

  const cache = await env.NOTION_CACHE.get('cache');

  if (!cache) {
    await env.NOTION_CACHE.put('cache', JSON.stringify(sortedEvents));
    return console.log('Notion 👉 GCal: Cache Does Not Exist. Created New Cache.');
  } else {
    await env.NOTION_CACHE.put('cache', JSON.stringify(sortedEvents));
    console.log('Notion 👉 GCal: Created New Cache.');
  }

  if (cache === JSON.stringify(sortedEvents)) {
    return console.log('Notion 👉 GCal: No Changes.');
  }

  const cachedEvents: Event[] = cache ? JSON.parse(cache) : [];
  console.log('Notion 👉 GCal: Cached Events', cachedEvents);

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

  console.log('Notion 👉 GCal', 'new:', newEvents, 'delete:', deletedEvents, 'update:', updatedEvents);

  const isDeleted = deletedEvents.length > 0;
  const isUpdated = updatedEvents.length > 0;
  const isNew = newEvents.length > 0;

  await env.LAST_SYNC.put('lastSync', 'true');

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
    console.error('Notion 👉 GCal: Failed!!!', e);
    return;
  }

  await env.LAST_SYNC.put('lastSync', 'false');

  return console.log('------ Synced successfully ------');
};

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Bindings, ctx: ExecutionContext) {
    switch (event.cron) {
      case '*/1 * * * *':
        console.log('🔥🔥🔥 #1 🔥🔥🔥');
        await watchNotion(env);
        console.log('🔥🔥🔥 #2 🔥🔥🔥');
        await watchGCal(env);
        break;
    }
  },
};
