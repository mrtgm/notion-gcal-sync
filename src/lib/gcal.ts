// CRUD

import { calendar_v3 } from '@googleapis/calendar';
import { getGoogleAuthToken } from './auth';
import { Event } from '../type';
import { normDate, parseTag } from './util';

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
    const end = normDate(event.end?.dateTime || event.end?.date || '');
    const preTitle = event.summary || '';
    const pageId = event.extendedProperties?.private?.pageId || '';

    const { tag, title } = parseTag(preTitle);

    return {
      id,
      title,
      tag,
      start,
      end,
      pageId,
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
   * Fetch 100 events within the next 7 days from Google Calendar, with the earliest date first.
   * @returns Event[]
   */
  async getExistingEvents() {
    const query: calendar_v3.Params$Resource$Events$List = {
      timeMax: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 100,
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
    return items?.map((event) => this.formatEvent(event)) || [];
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
          summary: `${event.tag} ${event.title}`,
          start: {
            dateTime: event.start,
          },
          end: {
            dateTime: event.end,
          },
          extendedProperties: {
            private: {
              pageId: event.pageId,
            },
          },
        }),
      });
      const json = (await res.json()) as calendar_v3.Schema$Event;
      return json;
    });
    const res = await Promise.all(promises);
    console.log('Google Calendar: Creation Finished');
    return res.map((event, i) => this.formatEvent(event));
  }

  /**
   * Update events on Google Calendar
   * @param events Events to be updated
   */
  async updateEvents(events: Event[]) {
    const promises = events.map((event) => {
      const url = `${this.baseUrl}/${this.calendarId}/events/${event.id}`;
      return fetch(url, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this._accessToken}`,
        },
        body: JSON.stringify({
          summary: `${event.tag} ${event.title}`,
          start: {
            dateTime: event.start,
          },
          end: {
            dateTime: event.end,
          },
          extendedProperties: {
            private: {
              pageId: event.pageId,
            },
          },
        }),
      });
    });
    await Promise.all(promises);
    console.log('Google Calendar: Update Finished');
  }
}

export default GCalAPI;
