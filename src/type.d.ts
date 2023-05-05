import { calendar_v3 } from "@googleapis/calendar";

type Result<T> = { success: true; data: T } | { success: false; error: string };
type PromiseResult<T> = Promise<Result<T>>;

type Event = {
  id: string;
  title: string;
  tag?: string | null;
  start: string;
  end: string;
  notionPageId?: string | null;
};

interface ExistingEvents extends calendar_v3.Schema$Event {
  pageId: string | undefined;
}
