import { Event, EventWithPageId } from "../type";

export const nonNullable = <T>(value: T): value is NonNullable<T> => value != null;

export const parseTag = (str: string) => {
  const regex = /\[(.+?)\]/gi;
  const match = regex.exec(str);
  return {
    tag: match ? match[1] : "",
    title: match ? str.replace(match[0], "") : str,
  };
};

// Notion -> GCal 方向への差分を比較
export const resolveDiffsFromNotion = ({ notionEvents, gcalEvents }: { notionEvents: EventWithPageId[]; gcalEvents: Event[] }) => {
  // Google Calendar ❌ | Notion ✅
  const newEvents = notionEvents?.filter((event) => {
    return !event.id;
  });

  // Google Calendar ✅ | Notion ❌
  const deletedEvents = gcalEvents.filter((v) => {
    return !notionEvents?.some((event) => event?.id === v?.id);
  });

  // Google Calendar ✅ | Notion ✅
  const updatedEvents = notionEvents?.reduce((acc: EventWithPageId[], event: EventWithPageId) => {
    if (!event.id) return [];
    const index = gcalEvents.findIndex((v) => v?.id === event.id);
    if (index < 0) return acc;

    return [
      ...acc,
      {
        ...event,
      },
    ];
  }, []);

  return {
    newEvents,
    deletedEvents,
    updatedEvents,
  };
};

// GCal -> Notion 方向への差分を比較
export const resolveDiffFromGCal = ({ notionEvent, gcalEvent }: { notionEvent: EventWithPageId | undefined | null; gcalEvent: Event }) => {
  // Google Calendar ✅ | Notion ❌
  const isNew = gcalEvent && !notionEvent;

  // Google Calendar ❌ (deletion flag) | Notion ✅
  const isDeleted = notionEvent && gcalEvent.deleted;

  // Google Calendar ✅ | Notion ✅
  const isUpdated = notionEvent && gcalEvent;

  return {
    isNew,
    isDeleted,
    isUpdated,
  };
};

export const resolveDiffsFromGCal = ({ notionEvents, gcalEvents }: { notionEvents: EventWithPageId[]; gcalEvents: Event[] }) => {
  // Google Calendar ✅ | Notion ❌
  const newEvents = gcalEvents?.filter((event) => {
    if (!event.id) return false;
    return !notionEvents.some((v) => v?.id === event.id);
  });

  // Google Calendar ❌ | Notion ✅
  const deletedEvents = notionEvents.filter((v) => {
    return !gcalEvents?.some((event) => event?.id === v?.id);
  });

  // Google Calendar ✅ | Notion ✅
  const updatedEvents = gcalEvents?.reduce((acc: EventWithPageId[], event: Event) => {
    if (!event.id) return [];
    const index = notionEvents.findIndex((v) => v?.id === event.id);
    if (index < 0) return acc;

    return [
      ...acc,
      {
        ...event,
        pageId: notionEvents[index]?.pageId,
      },
    ];
  }, []);

  return {
    newEvents,
    deletedEvents,
    updatedEvents,
  };
};
