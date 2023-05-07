import { Client } from '@notionhq/client';
import { nonNullable, normDate, normStr, parseTag } from './util';
import { Event } from '../type';
import { PageObjectResponse, PartialPageObjectResponse } from '@notionhq/client/build/src/api-endpoints';

class NotionAPI {
  client: Client;
  databaseId: string;

  constructor(token: string, databaseId: string) {
    this.client = new Client({
      auth: token,
    });
    this.databaseId = databaseId;
  }

  /**
   * Format event data from Notion API response
   * For this to work, you need to set the following properties for Notion database:
   * - Name: Title
   * - Date: Date (start and end)
   * - Event Id: Text
   *
   * @param event {PageObjectResponse | PartialPageObjectResponse} Raw event data from Notion API
   * @returns Event | undefined
   */
  formatEvent(event: PageObjectResponse | PartialPageObjectResponse): Event | undefined {
    if (!('properties' in event)) return;
    const id =
      event.properties['Event Id'].type === 'rich_text'
        ? event.properties['Event Id'].rich_text[0]?.plain_text ?? ''
        : '';
    const pageId = event.id;
    const start = normDate(event.properties['Date'].type === 'date' ? event.properties['Date'].date?.start ?? '' : '');
    const end = normDate(event.properties['Date'].type === 'date' ? event.properties['Date'].date?.end ?? '' : '');
    const title = normStr(
      event.properties['Name'].type === 'title' ? event.properties['Name'].title[0].plain_text : ''
    );
    const tag = normStr(event.properties['Tag'].type === 'select' ? event.properties['Tag'].select?.name ?? '' : '');

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
   * Fetch max 100 events within the next 7 days from Notion, with the earliest date first.
   * @returns Event[]
   */
  async getEvents() {
    const { results } = await this.client.databases.query({
      database_id: this.databaseId,
      sorts: [
        {
          property: 'Date',
          direction: 'ascending',
        },
      ],
      page_size: 50,
      filter: {
        and: [
          {
            property: 'Date',
            date: {
              after: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
              before: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
            },
          },
        ],
      },
    });

    return results.map(this.formatEvent).filter(nonNullable);
  }

  /**
   * Delete events from Notion
   * If the event has attendees, it will not be deleted.
   *
   * @param events {Event[]} Events to delete
   */
  async deleteEvents(events: Event[]) {
    const eventsToDelete = events.filter(
      (event: Event): event is Omit<Event, 'pageId'> & { pageId: string } => !!event.pageId
    );

    if (events.length !== eventsToDelete.length) {
      console.log('Notion: Some events are not deleted because they do not have pageId');
    }

    await Promise.all(
      eventsToDelete.map(async (event) => {
        const response = await this.client.pages.update({
          page_id: event.pageId,
          archived: true,
        });
        return response;
      })
    );
    console.log('Notion: Deletion Finished');
  }

  /**
   * Update events in Notion
   * @param events {Event[]} Events to update
   */
  async updateEvents(events: Event[]) {
    const eventsToUpdate = events.filter(
      (event: Event): event is Omit<Event, 'pageId'> & { pageId: string } => !!event.pageId
    );

    if (events.length !== eventsToUpdate.length) {
      console.log('Notion: Some events are not updated because they do not have pageId');
    }

    const res = await Promise.all(
      eventsToUpdate.map(async (event) => {
        const response = await this.client.pages.update({
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
            Tag: {
              select: {
                name: event.tag ?? '',
              },
            },
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
        });
        return response;
      })
    );
    const updatedEvents = res.map(this.formatEvent).filter(nonNullable);
    console.log('Notion: Update Finished', updatedEvents);
  }

  /**
   * Create events in Notion
   * @param events {Event[]} Events to create
   * @returns Event[] Created events
   */
  async createEvents(events: Event[]) {
    const res = await Promise.all(
      events.map(async (event) => {
        const response = await this.client.pages.create({
          parent: { database_id: this.databaseId },
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
            Tag: {
              select: {
                name: event.tag ?? '',
              },
            },
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
        });
        return response;
      })
    );
    const createdEvents = res.map(this.formatEvent).filter(nonNullable);
    console.log('Notion: Creation Finished', createdEvents);
    return createdEvents;
  }
}

export default NotionAPI;
