import { Event } from '../type';

/**
 * Type guard for non-nullable value
 * @param value
 * @returns {boolean}
 */
export const nonNullable = <T>(value: T): value is NonNullable<T> => value != null;

/** Normalize string
 * @param str String to normalize
 * @returns {string} Normalized string
 */
export const normStr = (str: string) => {
  if (!str) return '';
  return str.trim();
};

/**
 * Normalize date string to ISO 8601 format
 * @param str Date string to normalize
 * @returns {string} ISO 8601 formatted date string
 */
export const normDate = (str: string) => {
  if (!str) return '';
  const date = new Date(str);
  return date.toISOString();
};

/**
 * Compute start and end date for Google Calendar API.
 * If end date is not specified, set start date to 10:00 and end date to 11:00 (JST).
 *
 * @param start
 * @param end
 * @returns
 */
export const computeDate = (start: string, end: string | null | undefined) => {
  if (!end) {
    const exStart = new Date(start);
    exStart.setHours(1); // JST: 10
    const exEnd = new Date(start);
    exEnd.setHours(2); // JST: 11
    return {
      start: {
        dateTime: exStart.toISOString(),
      },
      end: {
        dateTime: exEnd.toISOString(),
      },
    };
  }
  return {
    start: {
      dateTime: start,
    },
    end: {
      dateTime: end,
    },
  };
};

/**
 * Separate tag from title. Tag is enclosed in square brackets.
 * @example parseTag('[tag] title') // { tag: 'tag', title: 'title' }
 * @param str String to parse
 * @returns {tag: string, title: string}
 */
export const parseTag = (str: string) => {
  const regex = /\[(.+?)\]/gi;
  const match = regex.exec(str);
  return {
    tag: match ? match[1] : '',
    title: normStr(match ? str.replace(match[0], '') : str),
  };
};

/**
 * Enclose string with tag
 * @param str String to enclose
 */
export const joinTag = (str: string, tag: string) => {
  return `[${tag}] ${str}`;
};

/**
 * Sort Events by start date and title
 */
export const sortEvents = (events: Event[]) => {
  return events.sort((a, b) => {
    if (a.start > b.start) return -1;
    else if (a.start < b.start) return 1;
    else {
      if (a.title > b.title) return 1;
      else if (a.title < b.title) return -1;
      else return 0;
    }
  });
};

/**
 * Compare the incoming events with the cached events
 * @param events  Incoming events from Google Calendar / Notion
 * @param cachedEvents Cached events from KV
 * @returns Events to be created, deleted, updated. And flags to indicate if there are any changes.
 */
export const compareEventsWithCache = (events: Event[], cachedEvents: Event[]) => {
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
