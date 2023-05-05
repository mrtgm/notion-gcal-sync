import { Client } from "@notionhq/client";
import { nonNullable, parseTag } from "./util";
import { ExistingEvents, Event } from "../type";
import { calendar_v3 } from "@googleapis/calendar";
import { PageObjectResponse, PartialPageObjectResponse } from "@notionhq/client/build/src/api-endpoints";

class NotionAPI {
  client: Client;
  databaseId: string;

  constructor(token: string, databaseId: string) {
    this.client = new Client({
      auth: token,
    });
    this.databaseId = databaseId;
  }

  formatEvent(event: PageObjectResponse | PartialPageObjectResponse): Event | undefined {
    if (!("properties" in event)) return;
    const id = event.properties["Event Id"].type === "rich_text" ? event.properties["Event Id"].rich_text[0].plain_text : "";
    const notionPageId = event.id;
    const start = event.properties["Date"].type === "date" ? event.properties["Date"].date?.start ?? "" : "";
    const end = event.properties["Date"].type === "date" ? event.properties["Date"].date?.end ?? "" : "";
    const preTitle = event.properties["Name"].type === "title" ? event.properties["Name"].title[0].plain_text : "";
    const { tag, title } = parseTag(preTitle);

    return {
      id,
      title,
      tag,
      start,
      end,
      notionPageId,
    };
  }

  async getExistingEvents() {
    const { results } = await this.client.databases.query({
      database_id: this.databaseId,
      sorts: [{ timestamp: "last_edited_time", direction: "descending" }],
      filter: {
        property: "Event Id",
        rich_text: {
          is_not_empty: true,
        },
      },
    });

    const existingEvents = results.map(this.formatEvent);
    return existingEvents.filter(nonNullable);
  }

  async getParentTaskFromTag(tag: string | undefined | null) {
    if (!tag) return null;

    const { results } = await this.client.databases.query({
      database_id: this.databaseId,
      filter: {
        property: "Tag",
        rich_text: {
          equals: tag,
        },
      },
    });

    if (results.length === 0) return null;
    return results[0];
  }

  async deleteEvents(events: Event[]) {
    await Promise.all(
      events.map(async (data) => {
        const pageId = data?.notionPageId || "";
        const response = await this.client.pages.update({
          page_id: pageId,
          archived: true,
        });
        return response;
      })
    );
    console.log(`Delete Notion Event for id: ${events.map((v) => v?.id).join(",")}`);
  }

  async updateEvents(events: Event[]) {
    await Promise.all(
      events.map(async (data) => {
        if (!data?.notionPageId) return;

        const response = await this.client.pages.update({
          page_id: data.notionPageId,
          properties: {
            Name: {
              title: [
                {
                  text: {
                    content: data.title,
                  },
                },
              ],
            },
            Date: {
              date: {
                start: data.start,
                end: data.end,
              },
            },
            "Event Id": {
              rich_text: [
                {
                  text: {
                    content: data.id,
                  },
                },
              ],
            },
          },
        });
        return response;
      })
    );
    console.log(`Updated Notion Event for id: ${events.map((v) => v.id).join(",")}`);
  }

  async createEvents(events: Event[]) {
    await Promise.all(
      events.map(async (data) => {
        const parent = await this.getParentTaskFromTag(data?.tag);

        const response = await this.client.pages.create({
          parent: { database_id: this.databaseId },
          properties: {
            Name: {
              title: [
                {
                  text: {
                    content: data.title,
                  },
                },
              ],
            },
            Date: {
              date: {
                start: data.start,
                end: data.end,
              },
            },
            "Event Id": {
              rich_text: [
                {
                  text: {
                    content: data.id,
                  },
                },
              ],
            },
            "Parent Item": {
              relation: parent
                ? [
                    {
                      id: parent.id,
                    },
                  ]
                : [],
            },
          },
        });
        return response;
      })
    );
    console.log(`Created Notion Event for id: ${events.map((v) => v.id).join(",")}`);
  }
}

export default NotionAPI;
