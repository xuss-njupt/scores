import { getSupabase } from "./supabase";

export type Notice = { kind: "success" | "error" | "info"; text: string } | null;
export type Notify = (notice: Notice) => void;

export function messageOf(error: unknown): string {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message;
  return "操作失败，请稍后重试。";
}

export async function callFunction<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabase().functions.invoke(name, { body });
  if (error) {
    let detail = "";
    if ("context" in error && error.context instanceof Response) {
      try {
        const payload = await error.context.json();
        if (typeof payload?.error === "string") detail = payload.error;
      } catch { /* use the SDK error when there is no JSON body */ }
    }
    throw new Error(detail || messageOf(error));
  }
  if (data?.error) throw new Error(String(data.error));
  return data as T;
}

export function adminAction<T = { ok: boolean }>(action: string, payload: Record<string, unknown> = {}) {
  return callFunction<T>("scores-admin", { action, ...payload });
}

export async function studentEmail(studentNo: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(studentNo.trim().toUpperCase()));
  const hex = [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return "student-" + hex.slice(0, 40) + "@students.scores.invalid";
}

// Supabase limits a single REST response to 1000 rows. Always use stable ordering.
export async function readAll<T>(
  load: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>,
): Promise<T[]> {
  const result: T[] = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await load(offset, offset + pageSize - 1);
    if (error) throw error;
    const page = data ?? [];
    result.push(...page as T[]);
    if (page.length < pageSize) return result;
  }
}
