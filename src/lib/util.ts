import { Event } from '../type';

export const nonNullable = <T>(value: T): value is NonNullable<T> => value != null;

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const toLocaleIsoString = (date: any) => {
  if (!(date instanceof Date)) {
    date = new Date(date);
  }
  if (date.toString() === 'Invalid Date') {
    return 'Invalid Date';
  }

  console.log('original date', date);

  date.setHours(date.getHours() + 9);
  const pad = (num: number) => String(num).padStart(2, '0');
  const yyyy = date.getFullYear();
  const MM = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const mm = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  const tzMin = -540;
  const timezone = `${tzMin >= 0 ? '+' : '-'}${pad(Math.floor(Math.abs(tzMin) / 60))}:${pad(Math.abs(tzMin) % 60)}`;
  return `${yyyy}-${MM}-${dd}T${hh}:${mm}:${ss}${timezone}`;
};

export const normDate = (str: string) => {
  if (!str) return '';
  const date = new Date(str);
  return date.toISOString();
};

export const parseTag = (str: string) => {
  const regex = /\[(.+?)\]/gi;
  const match = regex.exec(str);
  return {
    tag: match ? match[1] : '',
    title: match ? str.replace(match[0], '') : str,
  };
};

// Notion -> GCal 方向への差分を比較
export const resolveDiffsFromNotion = ({
  notionEvents,
  gcalEvents,
}: {
  notionEvents: Event[];
  gcalEvents: Event[];
}) => {
  // Google Calendar ❌ | Notion ✅
  const newEvents = notionEvents?.filter((event) => {
    return !event.id;
  });

  // Google Calendar ✅ | Notion ❌
  const deletedEvents = gcalEvents.filter((v) => {
    return !notionEvents?.some((event) => event?.id === v?.id);
  });

  // Google Calendar ✅ | Notion ✅
  const updatedEvents = notionEvents?.reduce((acc: Event[], event: Event) => {
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
export const resolveDiffFromGCal = ({
  notionEvent,
  gcalEvent,
}: {
  notionEvent: Event | undefined | null;
  gcalEvent: Event;
}) => {
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

export const resolveDiffsFromGCal = ({ notionEvents, gcalEvents }: { notionEvents: Event[]; gcalEvents: Event[] }) => {
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
  const updatedEvents = gcalEvents?.reduce((acc: Event[], event: Event) => {
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
