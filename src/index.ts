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

type Bindings = {
  google_email: string;
  google_private_key: string;
  google_calendar_id: string;
};

const app = new Hono<{
  Bindings: Bindings;
}>();

app.get("/", async (c) => {
  const scope = "https://www.googleapis.com/auth/calendar";
  const res = await getGoogleAuthToken(c.env.google_email, c.env.google_private_key, scope);

  const query = {
    timeMin: new Date().toISOString(),
    timeMax: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
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
    return c.text(JSON.stringify(events.items));
  } else {
    console.log("error", res.error);
    c.text("Error");
  }
});

export default app;
