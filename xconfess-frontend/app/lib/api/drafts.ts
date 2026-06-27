import { Draft, DraftDTO, DraftInput, DraftUpdate } from "@/app/lib/types/draft";

/**
 * ASSUMPTION (no backend exists yet at /app/api/confessions/drafts):
 * REST contract is:
 *   GET    /api/confessions/drafts        -> DraftDTO[]
 *   POST   /api/confessions/drafts        -> DraftDTO        body: DraftInput
 *   PATCH  /api/confessions/drafts/:id    -> DraftDTO        body: DraftUpdate
 *   DELETE /api/confessions/drafts/:id    -> 204
 *
 * These hit Next.js route handlers (app/api/confessions/drafts/**) which
 * proxy to the real backend. If the actual backend contract differs,
 * only this file and the route handlers need to change — DraftManager
 * and useDrafts are insulated from it via the Draft type.
 */

export class DraftApiError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = "DraftApiError";
  }
}

function toDraft(dto: DraftDTO): Draft {
  const body = dto.content ?? "";
  const savedAt = dto.updatedAt ?? dto.savedAt ?? dto.createdAt ?? new Date().toISOString();
  return {
    id: dto.id,
    body,
    gender: dto.category as Draft["gender"],
    savedAt: new Date(savedAt).getTime(),
    characterCount: dto.characterCount ?? body.length,
    scheduledFor: dto.scheduledFor,
    timezone: dto.timezone,
  };
}

function toApiBody(draft: DraftInput | DraftUpdate) {
  return {
    content: draft.body,
    category: draft.gender,
    scheduledFor: "scheduledFor" in draft ? draft.scheduledFor : undefined,
    timezone: "timezone" in draft ? draft.timezone : undefined,
  };
}

async function parseJsonOrThrow(res: Response) {
  if (!res.ok) {
    let message = `Request failed with status ${res.status}`;
    try {
      const body = await res.json();
      if (body?.message) message = body.message;
    } catch {
      // response wasn't JSON; fall back to status-based message
    }
    throw new DraftApiError(message, res.status);
  }
  if (res.status === 204) return null;
  return res.json();
}

export async function fetchDrafts(token: string): Promise<Draft[]> {
  const res = await fetch("/api/confessions/drafts", {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = (await parseJsonOrThrow(res)) as DraftDTO[];
  return data.map(toDraft);
}

export async function createDraft(
  token: string,
  draft: DraftInput,
): Promise<Draft> {
  const res = await fetch("/api/confessions/drafts", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(toApiBody(draft)),
  });
  const data = (await parseJsonOrThrow(res)) as DraftDTO;
  return toDraft(data);
}

export async function patchDraft(
  token: string,
  id: string,
  updates: DraftUpdate,
): Promise<Draft> {
  const res = await fetch(`/api/confessions/drafts/${id}/autosave`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(toApiBody(updates)),
  });
  const data = (await parseJsonOrThrow(res)) as DraftDTO;
  return toDraft(data);
}

export async function deleteDraftRemote(
  token: string,
  id: string,
): Promise<void> {
  const res = await fetch(`/api/confessions/drafts/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  await parseJsonOrThrow(res);
}

export async function clearDraftsRemote(token: string): Promise<void> {
  const res = await fetch("/api/confessions/drafts", {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  await parseJsonOrThrow(res);
}
