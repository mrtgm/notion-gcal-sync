import { Hono } from 'hono';
import NotionAPI from './lib/notion';
import GCalAPI from './lib/gcal';
import { Event } from './type';
import { sortEvents } from './lib/util';

type Bindings = {
  google_email: string;
  google_private_key: string;
  google_calendar_id: string;
  notion_token: string;
  notion_database_id: string;
  EVENTS_CACHE: KVNamespace;
};

const app = new Hono<{
  Bindings: Bindings;
}>();

const watch = async (env: Bindings) => {
  console.log('------ Start Sync ------');
  console.log('Sync: Start', new Date().toLocaleString());

  const notion = new NotionAPI(env.notion_token, env.notion_database_id);
  const gcal = await GCalAPI.init(env.google_email, env.google_private_key, env.google_calendar_id);

  const eventsNotion = await notion.getEvents();
  const sortedEventsNotion = sortEvents(eventsNotion);
  const eventsMapNotion = new Map(sortEvents(eventsNotion).map((event) => [event.id, event]));

  const eventsGCal = await gcal.getEvents();
  const sortedEventsGCal = sortEvents(eventsGCal);
  const eventsMapGCal = new Map(sortedEventsGCal.map((event) => [event.id, event]));

  console.log('Sync: Incoming Events', 'gcal:', sortedEventsGCal, 'notion:', sortedEventsNotion);

  const cache = await env.EVENTS_CACHE.get('cache');
  const cachedEvents: Event[] = cache ? JSON.parse(cache) : [];
  const cachedMap = new Map(cachedEvents.map((event) => [event.id, event]));

  console.log('Sync: Cached Events', cachedEvents);

  if (!cache) {
    await env.EVENTS_CACHE.put('cache', JSON.stringify(sortedEventsGCal));
    return console.log('Sync: Cache Does Not Exist, Created New Cache');
  }

  if (cache === JSON.stringify(sortedEventsGCal) && cache === JSON.stringify(sortedEventsNotion)) {
    console.log('Sync: No Changes');
    return console.log('------ End Sync ------');
  }

  const inconsistentCacheToBeCreated = new Set<Event>();
  const inconsistentCacheToBeDeleted = cachedEvents.reduce((acc, event) => {
    // notion ❌ gcal ❌ cache ✅
    if (!eventsMapNotion.has(event.id) && !eventsMapGCal.has(event.id)) {
      acc.add(event);
    }
    return acc;
  }, new Set() as Set<Event>);

  const eventsSyncToGcal = eventsNotion.reduce(
    (acc, event) => {
      // notion ✅ gcal ❌ cache ❌ (new event in notion)
      if (!eventsMapGCal.has(event.id) && !cachedMap.has(event.id)) {
        acc.newEvents.add(event);
      }
      // notion ✅ gcal ❌ cache ✅ (deleted event in gcal)
      if (!eventsMapGCal.has(event.id) && cachedMap.has(event.id)) {
        acc.deletedEvents.add(event);
      }

      // notion ✅ gcal ✅ cache ❌ (inconsistent cache)
      if (eventsMapGCal.has(event.id) && !cachedMap.has(event.id)) {
        inconsistentCacheToBeCreated.add(event);
      }

      // notion ✅ gcal ✅ cache ✅ (possible updated event)
      if (eventsMapGCal.has(event.id) && cachedMap.has(event.id)) {
        const cachedEvent = cachedMap.get(event.id);
        if (
          cachedEvent &&
          (event.title !== cachedEvent.title ||
            event.tag !== cachedEvent.tag ||
            event.start !== cachedEvent.start ||
            event.end !== cachedEvent.end)
        ) {
          acc.updatedEvents.add(event);
        }
      }
      return acc;
    },
    {
      newEvents: new Set() as Set<Event>,
      deletedEvents: new Set() as Set<Event>,
      updatedEvents: new Set() as Set<Event>,
    }
  );

  const eventsSyncToNotion = eventsGCal.reduce(
    (acc, event) => {
      // notion ❌ gcal ✅ cache ❌ (new event in gcal)
      if (!eventsMapNotion.has(event.id) && !cachedMap.has(event.id)) {
        acc.newEvents.add(event);
      }

      // notion ❌ gcal ✅ cache ✅ (deleted event in notion)
      if (!eventsMapNotion.has(event.id) && cachedMap.has(event.id)) {
        acc.deletedEvents.add(event);
      }

      // notion ✅ gcal ✅ cache ✅ (possible updated event)
      if (eventsMapNotion.has(event.id) && cachedMap.has(event.id)) {
        const cachedEvent = cachedMap.get(event.id);
        if (
          cachedEvent &&
          (event.title !== cachedEvent.title ||
            event.tag !== cachedEvent.tag ||
            event.start !== cachedEvent.start ||
            event.end !== cachedEvent.end)
        ) {
          acc.updatedEvents.add(event);
        }
      }

      return acc;
    },
    {
      newEvents: new Set() as Set<Event>,
      deletedEvents: new Set() as Set<Event>,
      updatedEvents: new Set() as Set<Event>,
    }
  );

  console.log('Sync: Events to be updated in Notion', eventsSyncToNotion);
  console.log('Sync: Events to be updated in GCal', eventsSyncToGcal);

  await Promise.all([
    eventsSyncToGcal.updatedEvents.size > 0 && gcal.updateEvents([...eventsSyncToGcal.updatedEvents]),
    eventsSyncToNotion.updatedEvents.size > 0 && notion.updateEvents([...eventsSyncToNotion.updatedEvents]),
  ]);

  console.log('Sync: Updated');

  await Promise.all([
    eventsSyncToGcal.deletedEvents.size > 0 && notion.deleteEvents([...eventsSyncToGcal.deletedEvents]),
    eventsSyncToNotion.deletedEvents.size > 0 && gcal.deleteEvents([...eventsSyncToNotion.deletedEvents]),
  ]);

  console.log('Sync: Deleted');

  const [createdEventsInGCal, createdEventsInNotion] = await Promise.all([
    eventsSyncToGcal.newEvents.size > 0 && gcal.createEvents([...eventsSyncToGcal.newEvents]),
    eventsSyncToNotion.newEvents.size > 0 && notion.createEvents([...eventsSyncToNotion.newEvents]),
  ]);

  console.log('Sync: Created Events', createdEventsInNotion, createdEventsInGCal);

  await Promise.all([
    createdEventsInGCal && notion.updateEvents(createdEventsInGCal),
    createdEventsInNotion && gcal.updateEvents(createdEventsInNotion),
  ]);

  console.log('Sync: Updated for Created Events');

  const cacheToBeCreated = [
    ...(createdEventsInNotion || []),
    ...(createdEventsInGCal || []),
    ...inconsistentCacheToBeCreated,
  ];

  const cacheToBeDeleted = [
    ...eventsSyncToGcal.deletedEvents,
    ...eventsSyncToNotion.deletedEvents,
    ...inconsistentCacheToBeDeleted,
  ];

  const cacheToBeUpdated = [...eventsSyncToGcal.updatedEvents, ...eventsSyncToNotion.updatedEvents];

  console.log('Sync: Caches', 'created', cacheToBeCreated, 'delete', cacheToBeDeleted, 'update', cacheToBeUpdated);

  const cacheToBeSaved = sortEvents(
    cachedEvents
      .filter((event) => {
        if (cacheToBeDeleted.find((e) => e.id === event.id)) return false;
        if (cacheToBeUpdated.find((e) => e.id === event.id)) return false;
        return true;
      })
      .concat([...cacheToBeCreated, ...cacheToBeUpdated])
  );

  await env.EVENTS_CACHE.put('cache', JSON.stringify(cacheToBeSaved));
  console.log("Sync: Cache's been updated:", cacheToBeSaved);

  console.log('Sync: End', new Date().toLocaleString());
  return console.log('------ End Sync ------');
};

const main = async (env: Bindings) => {
  const start = Date.now();
  await watch(env);
  const end = Date.now();
  const elapsed = end - start;
  console.log('🔥🔥🔥 #3: Sync Completed 🔥🔥🔥', elapsed.toString() + 'ms');
  return;
};

app.get('/', async (c) => {
  await main(c.env);
  return c.text('ok');
});

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Bindings, ctx: ExecutionContext) {
    switch (event.cron) {
      case '0 0 1 * *':
        await main(env);
        break;
    }
  },
};
