import { calendar_v3 } from '@googleapis/calendar';
import { getGoogleAuthToken } from './auth';
import { Event } from '../type';
import { computeDate, joinTag, normDate, normStr, parseTag } from './util';

class GCalAPI {
  scope = 'https://www.googleapis.com/auth/calendar';
  baseUrl = 'https://www.googleapis.com/calendar/v3/calendars';
  _accessToken = '';

  constructor(private email: string, private privateKey: string, private calendarId: string) {}

  /**
   * Initialize Google Calendar API
   * @param email
   * @param privateKey
   * @param calendarId
   * @returns GCalAPI instance
   */
  static async init(email: string, privateKey: string, calendarId: string) {
    const gcal = new GCalAPI(email, privateKey, calendarId);
    await gcal.getAccessToken();
    return gcal;
  }

  /**
   * Format raw event data from Google Calendar API
   * @param event calendar_v3.Schema$Event Raw event data from Google Calendar API
   * @returns
   */
  private formatEvent(event: calendar_v3.Schema$Event): Event {
    const id = event.id || '';
    const start = normDate(event.start?.dateTime || event.start?.date || '');
    const end = normDate(event.end?.dateTime || '');
    const preTitle = normStr(event.summary || '');
    const pageId = normStr(event.extendedProperties?.private?.pageId || '');
    const isM = event.start?.date ? true : false;

    const { tag, title } = parseTag(preTitle);

    return {
      id,
      title,
      tag,
      start,
      end,
      pageId,
      isM,
    };
  }

  /**
   * Fetch access token from Google OAuth2
   * @returns Promise<void>
   */
  async getAccessToken() {
    const res = await getGoogleAuthToken(this.email, this.privateKey, this.scope);
    if (res.success) {
      this._accessToken = res.data;
    } else {
      console.log('error', res.error);
    }
  }

  /**
   * Fetch max 30 events within the next 7 days from Google Calendar, with the earliest date first.
   * The event with attendees will be ignored.
   *
   * @returns Event[]
   */
  async getEvents() {
    const query: calendar_v3.Params$Resource$Events$List = {
      timeMin: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      timeMax: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 50,
    };

    const qs = new URLSearchParams(query as any).toString();
    const url = `${this.baseUrl}/${this.calendarId}/events?${qs}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this._accessToken}`,
      },
    });

    const { items }: calendar_v3.Schema$Events = await response?.json();

    // Filter out events not organized by self and events with attendees
    const filteredEvents = items?.filter((event) => event.organizer?.self && !event.attendees);
    return filteredEvents?.map((event) => this.formatEvent(event)) || [];
  }

  /**
   * Delete events on Google Calendar
   * @param events Events to be deleted
   */
  async deleteEvents(events: Event[]) {
    const promises = events.map((event) => {
      const url = `${this.baseUrl}/${this.calendarId}/events/${event.id}`;
      return fetch(url, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this._accessToken}`,
        },
      });
    });
    await Promise.all(promises);
    console.log('Google Calendar: Deletion Finished');
  }

  /**
   * Create events on Google Calendar
   * - If the event has tag 'Me', the event will be created as private.
   * - If the event has only start date, the event will be created as 10.00 - 11.00.
   *
   * @param events Events to be created
   * @returns Event[] Created events
   */
  async createEvents(events: Event[]) {
    const promises = events.map(async (event) => {
      const url = `${this.baseUrl}/${this.calendarId}/events`;

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this._accessToken}`,
        },
        body: JSON.stringify({
          summary: !!event.tag ? joinTag(event.title, event.tag) : event.title,
          ...computeDate(event.start, event.end, event.isM),
          extendedProperties: {
            private: {
              pageId: event.pageId,
            },
          },
          ...(event.tag === 'ME' && {
            visibility: 'private',
          }),
        }),
      });
      const json = (await res.json()) as calendar_v3.Schema$Event;
      return json;
    });
    const res = await Promise.all(promises);
    const createdEvents = res.map((event, i) => this.formatEvent(event));
    console.log('Google Calendar: Creation Finished', createdEvents);
    return createdEvents;
  }

  /**
   * Update events on Google Calendar
   * If the event has tag 'Me', the event will be created as private.
   *
   * @param events Events to be updated
   */
  async updateEvents(events: Event[]) {
    const promises = events.map(async (event) => {
      const url = `${this.baseUrl}/${this.calendarId}/events/${event.id}`;
      const res = await fetch(url, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this._accessToken}`,
        },
        body: JSON.stringify({
          summary: !!event.tag ? joinTag(event.title, event.tag) : event.title,
          ...computeDate(event.start, event.end, event.isM),
          extendedProperties: {
            private: {
              pageId: event.pageId,
            },
          },
          ...(event.tag === 'ME' && {
            visibility: 'private',
          }),
        }),
      });
      const json = (await res.json()) as calendar_v3.Schema$Event;
      return json;
    });
    const res = await Promise.all(promises);
    const updatedEvents = res.map((event, i) => this.formatEvent(event));
    console.log('Google Calendar: Update Finished', updatedEvents);
    return updatedEvents;
  }
}

export default GCalAPI;
