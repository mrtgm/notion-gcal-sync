type Result<T> = { success: true; data: T } | { success: false; error: string };
type PromiseResult<T> = Promise<Result<T>>;
