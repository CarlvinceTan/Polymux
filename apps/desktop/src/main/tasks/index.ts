import type {TaskCardDto, TaskCardInput, TaskCardPatch} from "@flareai/protocol";
import type {ChatPool} from "../agent/chat-pool.js";

/** Tasks is a chat-scoped view over the durable ChatPool. */
export class TaskBoard {
  readonly #jobs: ChatPool;

  constructor(jobs: ChatPool) {
    this.#jobs = jobs;
  }

  subscribe(listener: (items: TaskCardDto[]) => void): () => void {
    return this.#jobs.subscribe(() => listener(this.list()));
  }

  list(chatId?: string): TaskCardDto[] {
    return this.#jobs.cards(chatId);
  }

  create(input: TaskCardInput): TaskCardDto {
    return this.#jobs.createCard(input);
  }

  update(id: string, patch: TaskCardPatch): TaskCardDto {
    return this.#jobs.updateCard(id, patch);
  }

  remove(id: string): void {
    this.#jobs.removeCard(id);
  }

  markRead(id: string): TaskCardDto {
    return this.#jobs.markCardRead(id);
  }

  claim(id: string, owner: string): TaskCardDto {
    return this.#jobs.claimCard(id, owner);
  }

  complete(id: string, owner: string): TaskCardDto {
    return this.#jobs.completeCard(id, owner);
  }

  recycle(id: string): TaskCardDto {
    return this.#jobs.recycleCard(id);
  }
}
