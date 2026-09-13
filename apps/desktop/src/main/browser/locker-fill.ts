import type {
  BrowserAutofillItemDto,
  BrowserAutofillOfferDto,
  LockerItemDto,
  SavedLoginDto,
} from "@polymux/protocol";
import type { AutofillFocus } from "./autofill.js";

export type AutofillPage = {
  origin: string;
  forms: number;
  otp: number;
  focus: AutofillFocus | null;
};

export type AutofillItemRef = { source: "locker" | "browser"; id: string };

export function encodeAutofillItem(source: AutofillItemRef["source"], id: string): string {
  return `${source}:${id}`;
}

export function parseAutofillItem(value: string): AutofillItemRef | null {
  const split = value.indexOf(":");
  if (split <= 0) return null;
  const source = value.slice(0, split);
  const id = value.slice(split + 1);
  if ((source !== "locker" && source !== "browser") || !id) return null;
  return { source, id };
}

export function lockerAutofillItems(items: LockerItemDto[]): BrowserAutofillItemDto[] {
  return items
    .filter((item) => item.hasPassword || item.hasTotp)
    .map((item) => ({
      id: encodeAutofillItem("locker", item.id),
      source: "locker" as const,
      title: item.title,
      username: item.username,
      hasPassword: item.hasPassword,
      hasTotp: item.hasTotp,
    }));
}

export function browserAutofillItems(logins: SavedLoginDto[]): BrowserAutofillItemDto[] {
  return logins.map((login) => ({
    id: encodeAutofillItem("browser", login.id),
    source: "browser" as const,
    title: login.username || login.origin,
    username: login.username,
    hasPassword: true,
    hasTotp: false,
  }));
}

export function buildAutofillOffer(input: {
  tabId: string;
  page: AutofillPage;
  locker: "missing" | "locked" | "unlocked";
  lockerItems: LockerItemDto[];
  browserLogins: SavedLoginDto[];
}): BrowserAutofillOfferDto | null {
  const { page } = input;
  if (page.forms <= 0 && page.otp <= 0) return null;
  const items = [
    ...(input.locker === "unlocked" ? lockerAutofillItems(input.lockerItems) : []),
    ...browserAutofillItems(input.browserLogins),
  ];
  if (items.length === 0 && input.locker !== "locked") return null;
  return {
    tabId: input.tabId,
    origin: page.origin,
    locker: input.locker,
    focus: page.focus,
    items,
  };
}
