// CRUD

import { calendar_v3 } from "@googleapis/calendar";
import { getGoogleAuthToken } from "./auth";
import { Event } from "../type";
import { parseTag } from "./util";

class GCalAPI {
  scope = "https://www.googleapis.com/auth/calendar";
  baseUrl = "https://www.googleapis.com/calendar/v3/calendars";

  _accessToken = "";

  constructor(private email: string, private privateKey: string, private calendarId: string) {}

  static async init(email: string, privateKey: string, calendarId: string) {
    const gcal = new GCalAPI(email, privateKey, calendarId);
    await gcal.getAccessToken();
    return gcal;
  }

  private formatEvent(event: calendar_v3.Schema$Event): Event {
    const id = event.id || "";
    const start = event.start?.dateTime || event.start?.date || "";
    const end = event.end?.dateTime || event.end?.date || "";
    const deleted = event.status === "cancelled";
    const preTitle = event.summary || "";

    const { tag, title } = parseTag(preTitle);

    return {
      id,
      title,
      tag,
      start,
      end,
      deleted,
    };
  }

  async getAccessToken() {
    const res = await getGoogleAuthToken(this.email, this.privateKey, this.scope);
    if (res.success) {
      this._accessToken = res.data;
    } else {
      console.log("error", res.error);
    }
  }

  async getExistingEvents(syncToken?: string | null | undefined) {
    const query: calendar_v3.Params$Resource$Events$List = {
      timeMin: new Date().toISOString(),
      timeMax: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      singleEvents: true,
      maxResults: 100, // Notion は1度に100件以上のページを取得できないため、100件で Limit
    };

    if (syncToken) {
      query.syncToken = syncToken;
      delete query.timeMin;
      delete query.timeMax;
    }

    const qs = new URLSearchParams(query as any).toString();
    const url = `${this.baseUrl}/${this.calendarId}/events?${qs}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this._accessToken}`,
      },
    });

    const res: calendar_v3.Schema$Events = await response?.json();

    return {
      items: res.items?.map((event) => this.formatEvent(event)),
      nextSyncToken: res.nextSyncToken,
    };
  }
}

export default GCalAPI;
