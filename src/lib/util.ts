import { Event } from '../type';

/**
 * Type guard for non-nullable value
 * @param value
 * @returns {boolean}
 */
export const nonNullable = <T>(value: T): value is NonNullable<T> => value != null;

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

/**
 * Normalize date string to ISO 8601 format
 * @param str {string} Date string to normalize
 * @returns {string} ISO 8601 formatted date string
 */
export const normDate = (str: string) => {
  if (!str) return '';
  const date = new Date(str);
  return date.toISOString();
};

/**
 * Separate tag from title. Tag is enclosed in square brackets.
 * @example parseTag('[tag] title') // { tag: 'tag', title: 'title' }
 * @param str {string} String to parse
 * @returns {tag: string, title: string}
 */
export const parseTag = (str: string) => {
  const regex = /\[(.+?)\]/gi;
  const match = regex.exec(str);
  return {
    tag: match ? match[1] : '',
    title: match ? str.replace(match[0], '') : str,
  };
};

/**
 * Compare the incoming events with the cached events
 * @param events {Event[]} Incoming events from Google Calendar / Notion
 * @param cachedEvents {Event[]} Cached events from KV
 * @returns {newEvents, deletedEvents, updatedEvents, isNew, isDeleted, isUpdated} Events to be created, deleted, updated. And flags to indicate if there are any changes.
 */
export const compareWithCache = (events: Event[], cachedEvents: Event[]) => {
  const newEvents = events.filter((event) => {
    return !cachedEvents.some((cachedEvent) => cachedEvent.id === event.id);
  });

  const deletedEvents = cachedEvents.filter((cachedEvent) => {
    return !events.some((event) => event.id === cachedEvent.id);
  });

  const updatedEvents = events.filter((event) => {
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

  return { newEvents, deletedEvents, updatedEvents, isNew, isDeleted, isUpdated };
};
