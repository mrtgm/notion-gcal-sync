/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `wrangler dev src/index.ts` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `wrangler publish src/index.ts --name my-worker` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */
import { Env, Hono, HonoRequest } from "hono";
import { getGoogleAuthToken } from "./lib/auth";
import { calendar_v3 } from "@googleapis/calendar";
import { Client } from "@notionhq/client";

type Bindings = {
  google_email: string;
  google_private_key: string;
  google_calendar_id: string;
  notion_token: string;
  notion_database_id: string;
};

const app = new Hono<{
  Bindings: Bindings;
}>();

interface ExistingEvents extends calendar_v3.Schema$Event {
  pageId: string | undefined;
}

app.get("/", async (c) => {
  const scope = "https://www.googleapis.com/auth/calendar";
  const res = await getGoogleAuthToken(c.env.google_email, c.env.google_private_key, scope);

  const query = {
    timeMin: new Date().toISOString(),
    timeMax: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "5",
  };

  const qs = new URLSearchParams(query).toString();
  const url = `https://www.googleapis.com/calendar/v3/calendars/${c.env.google_calendar_id}/events?${qs}`;

  if (res.success) {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${res.data}`,
      },
    });

    const events = (await response.json()) as calendar_v3.Schema$Events;

    const client = new Client({ auth: c.env.notion_token });

    if (!events.items || events.items.length === 0) return;

    // Notion は1度に100件以上のページを取得できないため、
    // 1週間に100件以上のイベントが存在する場合は正しく動作しないが、とりま考慮せずに実装

    const getExistingNotionEvents = async () => {
      const { results } = await client.databases.query({
        database_id: c.env.notion_database_id,
        sorts: [{ timestamp: "last_edited_time", direction: "descending" }],
        filter: {
          property: "eventId",
          rich_text: {
            is_not_empty: true,
          },
        },
      });

      const existingEventIds = results.map((result) => {
        if (!("properties" in result)) return;
        const { eventId } = result.properties;
        if (eventId.type === "rich_text") {
          return {
            id: result.id,
            eventId: eventId.rich_text[0].plain_text,
          };
        }
      });

      return existingEventIds;
    };

    const getParentTaskByTag = async (tag: string) => {
      if (!tag) return null;

      const { results } = await client.databases.query({
        database_id: c.env.notion_database_id,
        filter: {
          property: "Tag",
          rich_text: {
            equals: tag,
          },
        },
      });

      if (results.length === 0) return null;
      return results[0];
    };

    const existingNotionEvents = await getExistingNotionEvents();

    const newEvents = events.items.filter((event) => {
      if (!event.id) return false;
      return !existingNotionEvents.some((v) => v?.eventId === event.id);
    });

    const deletedEvents = existingNotionEvents.filter((v) => {
      if (!events.items || events.items.length === 0) return;
      return !events.items.some((event) => event?.id === v?.eventId);
    });

    const existingEvents = events.items.reduce((acc, event) => {
      if (!event.id) return [];
      const index = existingNotionEvents.findIndex((v) => v?.eventId === event.id);
      if (index < 0) return acc;

      return [
        ...acc,
        {
          ...event,
          pageId: existingNotionEvents[index]?.id,
        },
      ];
    }, [] as ExistingEvents[]);

    // delete
    await Promise.all(
      deletedEvents.map(async (data) => {
        const pageId = data?.id || "";
        const response = await client.pages.update({
          page_id: pageId,
          archived: true,
        });
        return response;
      })
    );
    console.log(`Delete Notion Event for id: ${deletedEvents.map((v) => v?.id).join(",")}`);

    // update
    await Promise.all(
      existingEvents.map(async (data) => {
        const title = data.summary || "";
        const start = data.start?.dateTime || "";
        const end = data.end?.dateTime || "";
        const eventId = data.id || "";

        if (!data?.pageId) return;

        const response = await client.pages.update({
          page_id: data.pageId,
          properties: {
            Name: {
              title: [
                {
                  text: {
                    content: title,
                  },
                },
              ],
            },
            Date: {
              date: {
                start,
                end,
              },
            },
            eventId: {
              rich_text: [
                {
                  text: {
                    content: eventId,
                  },
                },
              ],
            },
          },
        });
        return response;
      })
    );
    console.log(`Updated Notion Event for id: ${existingEvents.map((v) => v.id).join(",")}`);

    const parseTag = (str: string) => {
      const regex = /\[(.+?)\]/g;
      const match = regex.exec(str);
      return {
        tag: match ? match[1] : "",
        title: match ? str.replace(match[0], "") : str,
      };
    };

    // create
    await Promise.all(
      newEvents.map(async (data) => {
        const { title, tag } = parseTag(data.summary || "");
        const start = data.start?.dateTime || "";
        const end = data.end?.dateTime || "";
        const eventId = data.id || "";

        const parent = await getParentTaskByTag(tag);

        console.log(parent, tag, title, start, end, eventId, "why???????");

        const response = await client.pages.create({
          parent: { database_id: c.env.notion_database_id },
          properties: {
            Name: {
              title: [
                {
                  text: {
                    content: title,
                  },
                },
              ],
            },
            Date: {
              date: {
                start,
                end,
              },
            },
            eventId: {
              rich_text: [
                {
                  text: {
                    content: eventId,
                  },
                },
              ],
            },
            親タスク: {
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
    console.log(`Created Notion Event for id: ${newEvents.map((v) => v.id).join(",")}`);

    return c.text("Hello");
  } else {
    console.log("error", res.error);
    c.text("Error");
  }
});

export default app;
