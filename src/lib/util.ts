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

export const resolveDiff = ({ notionEvent, gcalEvent }: { notionEvent: EventWithPageId; gcalEvent: Event }) => {
  // Google Calendar に存在するが Notion に存在しないイベント
  const isNew = gcalEvent && !notionEvent;

  // Google Calendar で削除フラグの立てられたイベント
  const isDeleted = notionEvent && gcalEvent.deleted;

  // Notion にも Google Calendar にも存在するイベント
  const isUpdated = notionEvent && gcalEvent;

  return {
    isNew,
    isDeleted,
    isUpdated,
  };
};

export const resolveDiffs = ({ notionEvents, gcalEvents }: { notionEvents: EventWithPageId[]; gcalEvents: Event[] }) => {
  const newEvents = gcalEvents?.filter((event) => {
    if (!event.id) return false;
    return !notionEvents.some((v) => v?.id === event.id);
  });

  const deletedEvents = notionEvents.filter((v) => {
    return !gcalEvents?.some((event) => event?.id === v?.id);
  });

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
