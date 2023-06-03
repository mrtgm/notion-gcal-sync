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

export const convertToDateString = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  const dateString = `${year}-${month}-${day}`;

  return dateString;
};

/**
 * Compute start and end date for Google Calendar API.
 * If end date is not specified, set start date to 10:00 and end date to 11:00 (JST).
 * If end date is not specified and the event is a milestone, set date without time.
 *
 * @param start
 * @param end
 * @returns
 */
export const computeDate = (start: string, end: string | null | undefined, isMilestone: boolean) => {
  if (!end) {
    const exStart = new Date(start);
    const exEnd = new Date(start);

    if (isMilestone) {
      exEnd.setDate(exStart.getDate() + 1);
      return {
        start: {
          date: convertToDateString(exStart),
        },
        end: {
          date: convertToDateString(exEnd),
        },
      };
    }

    exStart.setHours(1); // JST: 10
    exEnd.setHours(2); // JST: 11

    return {
      start: {
        dateTime: exStart.toISOString(),
      },
      end: {
        dateTime: exEnd.toISOString(),
      },
    };
  } else {
    return {
      start: {
        dateTime: start,
      },
      end: {
        dateTime: end,
      },
    };
  }
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
