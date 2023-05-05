import { Client } from "@notionhq/client";
import { nonNullable, parseTag } from "./util";
import { ExistingEvents, Event, EventWithPageId } from "../type";
import { calendar_v3 } from "@googleapis/calendar";
import { PageObjectResponse, PartialPageObjectResponse, UpdatePageParameters, CreatePageParameters } from "@notionhq/client/build/src/api-endpoints";

const buildUpdateOption = (event: EventWithPageId): UpdatePageParameters => {
  return {
    page_id: event.pageId,
    properties: {
      Name: {
        title: [
          {
            text: {
              content: event.title,
            },
          },
        ],
      },
      ...(event.start && event.end
        ? {
            Date: {
              date: {
                start: event.start,
                end: event.end,
              },
            },
          }
        : {}),
      "Event Id": {
        rich_text: [
          {
            text: {
              content: event.id,
            },
          },
        ],
      },
    },
  };
};

const buildCreateOption = (event: Event, parent: PartialPageObjectResponse | null, databaseId: string): CreatePageParameters => {
  return {
    parent: { database_id: databaseId },
    properties: {
      Name: {
        title: [
          {
            text: {
              content: event.title,
            },
          },
        ],
      },
      ...(event.start && event.end
        ? {
            Date: {
              date: {
                start: event.start,
                end: event.end,
              },
            },
          }
        : {}),
      "Event Id": {
        rich_text: [
          {
            text: {
              content: event.id,
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
  };
};

class NotionAPI {
  client: Client;
  databaseId: string;

  constructor(token: string, databaseId: string) {
    this.client = new Client({
      auth: token,
    });
    this.databaseId = databaseId;
  }

  formatEvent(event: PageObjectResponse | PartialPageObjectResponse): EventWithPageId | undefined {
    if (!("properties" in event)) return;
    const id = event.properties["Event Id"].type === "rich_text" ? event.properties["Event Id"].rich_text[0]?.plain_text ?? "" : "";
    const pageId = event.id;
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
      pageId,
    };
  }

  async getExistingEventById(id: string) {
    const { results } = await this.client.databases.query({
      database_id: this.databaseId,
      filter: {
        property: "Event Id",
        rich_text: {
          equals: id,
        },
      },
    });

    if (results.length === 0) return null;
    return this.formatEvent(results[0]);
  }

  async getExistingEvents() {
    const { results } = await this.client.databases.query({
      database_id: this.databaseId,
      sorts: [{ timestamp: "last_edited_time", direction: "descending" }],
      filter: {
        and: [
          {
            property: "Date",
            date: {
              is_not_empty: true,
            },
          },
        ],
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

  async deleteEvent(event: EventWithPageId) {
    await this.client.pages.update({
      page_id: event.pageId,
      archived: true,
    });
    console.log(`Delete Notion Event: ${event.id}`);
  }

  async deleteEvents(events: EventWithPageId[]) {
    await Promise.all(
      events.map(async (data) => {
        const pageId = data?.pageId || "";
        const response = await this.client.pages.update({
          page_id: pageId,
          archived: true,
        });
        return response;
      })
    );
    console.log(`Delete Notion Events: ${events.map((v) => v?.id).join(",")}`);
  }

  async updateEvent(event: EventWithPageId) {
    if (!event?.pageId) return;
    await this.client.pages.update(buildUpdateOption(event));
    console.log(`Updated Notion Event: ${event.id}`);
  }

  async updateEvents(events: EventWithPageId[]) {
    await Promise.all(
      events.map(async (event) => {
        if (!event?.pageId) return;
        const response = await this.client.pages.update(buildUpdateOption(event));
        return response;
      })
    );
    console.log(`Updated Notion Events: ${events.map((v) => v.id).join(",")}`);
  }

  async createEvent(event: Event) {
    const parent = await this.getParentTaskFromTag(event?.tag);
    await this.client.pages.create(buildCreateOption(event, parent, this.databaseId));
    console.log(`Created Notion Event: ${event.id}`);
  }

  async createEvents(events: Event[]) {
    console.log(events, "created!!!");
    await Promise.all(
      events.map(async (data) => {
        const parent = await this.getParentTaskFromTag(data?.tag);

        const response = await this.client.pages.create(buildCreateOption(data, parent, this.databaseId));
        return response;
      })
    );
    console.log(`Created Notion Events: ${events.map((v) => v.id).join(",")}`);
  }
}

export default NotionAPI;
