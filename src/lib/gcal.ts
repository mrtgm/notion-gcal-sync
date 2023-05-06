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

  static async init(email: string, privateKey: string, calendarId: string) {
    const gcal = new GCalAPI(email, privateKey, calendarId);
    await gcal.getAccessToken();
    return gcal;
  }

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

  async getAccessToken() {
    const res = await getGoogleAuthToken(this.email, this.privateKey, this.scope);
    if (res.success) {
      this._accessToken = res.data;
    } else {
      console.log('error', res.error);
    }
  }

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
    console.log('Google Calendar: Deleted events Finished');
  }

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
    console.log('Google Calendar: Created events Finished');
    return res.map((event, i) => this.formatEvent(event));
  }

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
    console.log('Google Calendar: Updated events Finished');
  }
}

export default GCalAPI;
