import { calendar_v3 } from '@googleapis/calendar';

type Result<T> = { success: true; data: T } | { success: false; error: string };
type PromiseResult<T> = Promise<Result<T>>;

/**
 * Cached event type of Google Calendar API / Notion API response.
 * Id and pageId may be empty string. (Notion API response does not have id, and Google Calendar API response does not have pageId)
 *
 * @property id - Event id for Google Calendar API
 * @property title - Event title
 * @property tag - Tag
 * @property start - Event start date in ISO 8601
 * @property end - Event end date in ISO 8601
 * @property pageId -  Page id for Notion API
 */
type Event = {
  id: string;
  title: string;
  tag?: string | null;
  start: string;
  end: string;
  pageId?: string;
  isMilestone: boolean;
};
