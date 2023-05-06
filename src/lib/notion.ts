import { Client } from '@notionhq/client';
import { nonNullable, normDate, parseTag } from './util';
import { Event } from '../type';
import {
  PageObjectResponse,
  PartialPageObjectResponse,
  UpdatePageParameters,
  CreatePageParameters,
} from '@notionhq/client/build/src/api-endpoints';

const buildUpdateOption = (event: Event): UpdatePageParameters => {
  return {
    page_id: event.pageId ?? '',
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
      'Event Id': {
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

const buildCreateOption = (
  event: Event,
  parent: PartialPageObjectResponse | null,
  databaseId: string
): CreatePageParameters => {
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
      'Event Id': {
        rich_text: [
          {
            text: {
              content: event.id,
            },
          },
        ],
      },
      'Parent Item': {
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

  formatEvent(event: PageObjectResponse | PartialPageObjectResponse): Event | undefined {
    if (!('properties' in event)) return;
    const id =
      event.properties['Event Id'].type === 'rich_text'
        ? event.properties['Event Id'].rich_text[0]?.plain_text ?? ''
        : '';
    const pageId = event.id;
    const start = normDate(event.properties['Date'].type === 'date' ? event.properties['Date'].date?.start ?? '' : '');
    const end = normDate(event.properties['Date'].type === 'date' ? event.properties['Date'].date?.end ?? '' : '');
    const preTitle = event.properties['Name'].type === 'title' ? event.properties['Name'].title[0].plain_text : '';
    const lastEdited = event.last_edited_time;
    const { tag, title } = parseTag(preTitle);

    return {
      id,
      title,
      tag,
      start,
      end,
      pageId,
      lastEdited,
    };
  }

  async getExistingEventById(id: string) {
    const { results } = await this.client.databases.query({
      database_id: this.databaseId,
      filter: {
        property: 'Event Id',
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
      sorts: [
        {
          property: 'Date',
          direction: 'ascending',
        },
      ],
      page_size: 100,
      filter: {
        and: [
          {
            property: 'Date',
            date: {
              before: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
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
        property: 'Tag',
        rich_text: {
          equals: tag,
        },
      },
    });

    if (results.length === 0) return null;
    return results[0];
  }

  async deleteEvent(event: Event) {
    if (!event?.pageId) return;
    await this.client.pages.update({
      page_id: event.pageId,
      archived: true,
    });
    console.log('Notion: Deleted Event');
  }

  async deleteEvents(events: Event[]) {
    await Promise.all(
      events.map(async (event) => {
        if (!event?.pageId) return;
        const response = await this.client.pages.update({
          page_id: event.pageId,
          archived: true,
        });
        return response;
      })
    );
    console.log('Notion: Deleted Events');
  }

  async updateEvent(event: Event) {
    if (!event?.id) return;
    await this.client.pages.update(buildUpdateOption(event));
    console.log('Notion: Updated Event');
  }

  async updateEvents(events: Event[]) {
    await Promise.all(
      events.map(async (event) => {
        if (!event?.pageId) return;
        const response = await this.client.pages.update(buildUpdateOption(event));
        return response;
      })
    );
    console.log('Notion: Updated Events');
  }

  async createEvent(event: Event) {
    const parent = await this.getParentTaskFromTag(event?.tag);
    await this.client.pages.create(buildCreateOption(event, parent, this.databaseId));
    console.log('Notion: Created Event');
  }

  async createEvents(events: Event[]) {
    await Promise.all(
      events.map(async (data) => {
        const parent = await this.getParentTaskFromTag(data?.tag);
        const response = await this.client.pages.create(buildCreateOption(data, parent, this.databaseId));
        return response;
      })
    );
    console.log('Notion: Created Events');
  }
}

export default NotionAPI;
