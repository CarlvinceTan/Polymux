import {randomUUID} from "node:crypto";
import type {
  ContactLinkDto,
  ContactLinkMemberDto,
  JsonValue,
  MergeContactLinkRequest,
} from "@polymux/protocol";

const PREFERENCE_KEY = "hub-contact-links";
const MAX_MEMBERS = 32;

export interface ContactLinkPreferenceStore {
  getPreference(key: string): {value: unknown} | null | undefined;
  setPreference(key: string, value: JsonValue): unknown;
}

type StoredContactLinks = {version: 1; links: ContactLinkDto[]};

/** Persistent, local-only links between direct chats that represent one
 * person. No remote platform sees this grouping. */
export class ContactLinks {
  readonly #store: ContactLinkPreferenceStore;
  readonly #now: () => Date;
  readonly #id: () => string;
  #state: StoredContactLinks;

  constructor(
    store: ContactLinkPreferenceStore,
    options: {now?: () => Date; id?: () => string} = {},
  ) {
    this.#store = store;
    this.#now = options.now ?? (() => new Date());
    this.#id = options.id ?? randomUUID;
    this.#state = storedContactLinks(store.getPreference(PREFERENCE_KEY)?.value);
  }

  list(): ContactLinkDto[] {
    return structuredClone(this.#state.links);
  }

  /** Merging a member already present in another link extends that identity;
   * two overlapping links collapse into one instead of leaving contradictory
   * ownership behind. */
  merge(request: MergeContactLinkRequest): ContactLinkDto {
    const requested = uniqueMembers(request.members);
    if (requested.length < 2) throw new Error("Choose at least two conversations.");
    if (requested.length > MAX_MEMBERS)
      throw new Error(`One contact can link at most ${MAX_MEMBERS} conversations.`);
    if (new Set(requested.map((member) => member.platform)).size < 2)
      throw new Error("Choose conversations from at least two platforms.");

    const overlapping = this.#state.links.filter((link) =>
      link.members.some((member) => requested.some((candidate) => sameMember(member, candidate))),
    );
    const members = uniqueMembers([
      ...overlapping.flatMap((link) => link.members),
      ...requested,
    ]);
    if (members.length > MAX_MEMBERS)
      throw new Error(`One contact can link at most ${MAX_MEMBERS} conversations.`);

    const now = this.#now().toISOString();
    const name = request.name.trim() || overlapping[0]?.name || "Linked contact";
    const link: ContactLinkDto = {
      id: overlapping[0]?.id ?? `contact-${this.#id()}`,
      name,
      members,
      createdAt: overlapping[0]?.createdAt ?? now,
      updatedAt: now,
    };
    const replaced = new Set(overlapping.map((item) => item.id));
    this.#state.links = [link, ...this.#state.links.filter((item) => !replaced.has(item.id))];
    this.#save();
    return structuredClone(link);
  }

  remove(id: string): void {
    const next = this.#state.links.filter((link) => link.id !== id);
    if (next.length === this.#state.links.length) return;
    this.#state.links = next;
    this.#save();
  }

  #save(): void {
    this.#store.setPreference(PREFERENCE_KEY, this.#state as unknown as JsonValue);
  }
}

export function sameMember(left: ContactLinkMemberDto, right: ContactLinkMemberDto): boolean {
  if (left.platform !== right.platform) return false;
  const leftRemote = normalized(left.remoteId);
  const rightRemote = normalized(right.remoteId);
  return leftRemote && rightRemote
    ? leftRemote === rightRemote
    : left.chatId.trim() === right.chatId.trim();
}

function uniqueMembers(input: readonly ContactLinkMemberDto[]): ContactLinkMemberDto[] {
  const members: ContactLinkMemberDto[] = [];
  for (const raw of input) {
    const chatId = raw.chatId?.trim();
    if (!chatId || !raw.platform) continue;
    const member: ContactLinkMemberDto = {
      platform: raw.platform,
      remoteId: raw.remoteId?.trim() || null,
      chatId,
    };
    const existing = members.findIndex((candidate) => sameMember(candidate, member));
    if (existing < 0) members.push(member);
    else members[existing] = member;
  }
  return members;
}

function normalized(value: string | null): string {
  return value?.trim().normalize("NFKC").toLowerCase() ?? "";
}

function storedContactLinks(value: unknown): StoredContactLinks {
  if (!value || typeof value !== "object") return emptyState();
  const raw = value as Partial<StoredContactLinks>;
  if (raw.version !== 1 || !Array.isArray(raw.links)) return emptyState();
  return {version: 1, links: raw.links.filter(validLink).map((link) => ({
    ...structuredClone(link),
    members: uniqueMembers(link.members),
  }))};
}

function validLink(value: unknown): value is ContactLinkDto {
  if (!value || typeof value !== "object") return false;
  const link = value as Partial<ContactLinkDto>;
  return typeof link.id === "string" &&
    typeof link.name === "string" &&
    Array.isArray(link.members) &&
    typeof link.createdAt === "string" &&
    typeof link.updatedAt === "string";
}

function emptyState(): StoredContactLinks {
  return {version: 1, links: []};
}
