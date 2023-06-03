import { Hono } from 'hono';
import NotionAPI from './lib/notion';
import GCalAPI from './lib/gcal';
import { Event } from './type';
import { isEqualEvent, sortEvents } from './lib/util';

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

  const [eventsNotion, eventsGCal] = await Promise.all([notion.getEvents(), gcal.getEvents()]);
  const sortedEventsNotion = sortEvents(eventsNotion);
  const eventsMapNotion = new Map(sortEvents(eventsNotion).map((event) => [event.id, event]));
  const sortedEventsGCal = sortEvents(eventsGCal);
  const eventsMapGCal = new Map(sortedEventsGCal.map((event) => [event.id, event]));

  console.log(
    'Sync: Incoming Events',
    'gcal:',
    sortedEventsGCal.map((v) => v.title),
    'notion:',
    sortedEventsNotion.map((v) => v.title)
  );

  const cache = await env.EVENTS_CACHE.get('cache');
  const cachedEvents: Event[] = cache ? JSON.parse(cache) : [];
  const cachedMap = new Map(cachedEvents.map((event) => [event.id, event]));

  console.log(
    'Sync: Cached Events',
    cachedEvents.map((v) => v.title)
  );

  if (!cache) {
    await env.EVENTS_CACHE.put('cache', JSON.stringify(sortedEventsGCal));
    return console.log('Sync: Cache Does Not Exist, Created New Cache');
  }

  if (cache === JSON.stringify(sortedEventsGCal) && cache === JSON.stringify(sortedEventsNotion)) {
    console.log('Sync: No Changes');
    return console.log('------ End Sync ------');
  }

  const inconsistentCacheToBeCreated = eventsNotion.reduce((acc, event) => {
    // notion ✅ gcal ✅ cache ❌
    if (!cachedMap.has(event.id) && eventsMapGCal.has(event.id)) {
      acc.add(event);
    }
    return acc;
  }, new Set() as Set<Event>);

  const inconsistentCacheToBeDeleted = cachedEvents.reduce((acc, event) => {
    // notion ❌ gcal ❌ cache ✅
    if (!eventsMapNotion.has(event.id) && !eventsMapGCal.has(event.id)) {
      acc.add(event);
    }
    return acc;
  }, new Set() as Set<Event>);

  const eventsToBeDeleted = cachedEvents.reduce(
    (acc, event) => {
      // notion ❌ gcal ✅ cache ✅ (deleted event in notion)
      if (!eventsMapNotion.has(event.id) && eventsMapGCal.has(event.id)) {
        acc.gcal.add(event);
      }
      // notion ✅ gcal ❌ cache ✅ (deleted event in gcal)
      if (eventsMapNotion.has(event.id) && !eventsMapGCal.has(event.id)) {
        acc.notion.add(event);
      }
      return acc;
    },
    {
      notion: new Set<Event>(),
      gcal: new Set<Event>(),
    }
  );

  const eventsToBeUpdated = cachedEvents.reduce(
    (acc, event) => {
      if (eventsMapNotion.has(event.id) && eventsMapGCal.has(event.id)) {
        const notionEvent = eventsMapNotion.get(event.id);
        const gcalEvent = eventsMapGCal.get(event.id);
        // If the event is updated in both notion and gcal, notion will be always prioritized.
        // notion ✅ gcal ✅ cache ✅ (updated in notion)
        if (notionEvent && !isEqualEvent(notionEvent, event)) {
          acc.gcal.add(notionEvent);
          return acc;
        }
        // notion ✅ gcal ✅ cache ✅ (updated in gcal)
        if (gcalEvent && !isEqualEvent(gcalEvent, event)) {
          acc.notion.add(gcalEvent);
          return acc;
        }
      }
      return acc;
    },
    {
      notion: new Set<Event>(),
      gcal: new Set<Event>(),
    }
  );

  const eventsToBeCreatedInGcal = eventsNotion.reduce((acc, event) => {
    // notion ✅ gcal ❌ cache ❌ (new event in notion)
    if (!eventsMapGCal.has(event.id) && !cachedMap.has(event.id)) {
      acc.add(event);
    }
    return acc;
  }, new Set() as Set<Event>);

  const eventsToBeCreatedInNotion = eventsGCal.reduce((acc, event) => {
    // notion ❌ gcal ✅ cache ❌ (new event in gcal)
    if (!eventsMapNotion.has(event.id) && !cachedMap.has(event.id)) {
      acc.add(event);
    }
    return acc;
  }, new Set() as Set<Event>);

  console.log(
    'Sync: Inconsistent Cache',
    'to be created:',
    inconsistentCacheToBeCreated.size,
    'to be deleted:',
    inconsistentCacheToBeDeleted.size
  );
  console.log('Sync: New Events', 'notion:', eventsToBeCreatedInNotion.size, 'gcal:', eventsToBeCreatedInGcal.size);
  console.log('Sync: Deleted Events', 'notion:', eventsToBeDeleted.notion.size, 'gcal:', eventsToBeDeleted.gcal.size);
  console.log('Sync: Updated Events', 'notion:', eventsToBeUpdated.notion.size, 'gcal:', eventsToBeUpdated.gcal.size);

  await Promise.all([
    eventsToBeUpdated.gcal.size > 0 && gcal.updateEvents([...eventsToBeUpdated.gcal]),
    eventsToBeUpdated.notion.size > 0 && notion.updateEvents([...eventsToBeUpdated.notion]),
  ]);

  console.log('Sync: Update Complete');

  await Promise.all([
    eventsToBeDeleted.gcal.size > 0 && gcal.deleteEvents([...eventsToBeDeleted.gcal]),
    eventsToBeDeleted.notion.size > 0 && notion.deleteEvents([...eventsToBeDeleted.notion]),
  ]);

  console.log('Sync: Delete Complete');

  const [createdEventsInGCal, createdEventsInNotion] = await Promise.all([
    eventsToBeCreatedInGcal.size > 0 && gcal.createEvents([...eventsToBeCreatedInGcal]),
    eventsToBeCreatedInNotion.size > 0 && notion.createEvents([...eventsToBeCreatedInNotion]),
  ]);

  console.log('Sync: Created Events', createdEventsInNotion, createdEventsInGCal);

  // update events with id
  await Promise.all([
    createdEventsInGCal && notion.updateEvents(createdEventsInGCal), // GCal Event Id
    createdEventsInNotion && gcal.updateEvents(createdEventsInNotion), // Notion Page Id
  ]);

  console.log('Sync: Updated for Created Events');

  const cacheToBeCreated = [
    ...(createdEventsInNotion || []),
    ...(createdEventsInGCal || []),
    ...inconsistentCacheToBeCreated,
  ];

  const cacheToBeDeleted = [...eventsToBeDeleted.notion, ...eventsToBeDeleted.gcal, ...inconsistentCacheToBeDeleted];

  const cacheToBeUpdated = [...eventsToBeUpdated.gcal, ...eventsToBeUpdated.notion];

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
  console.log("Sync: Cache's been updated");

  console.log('Sync: End', new Date().toLocaleString());
  return console.log('------ End Sync ------');
};

const main = async (env: Bindings) => {
  const start = Date.now();
  await watch(env);
  const end = Date.now();
  const elapsed = end - start;
  console.log('Sync: Elapsed', elapsed);
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
