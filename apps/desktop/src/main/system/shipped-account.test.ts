import assert from "node:assert/strict";
import test from "node:test";
import {applyShippedAccountCredentials} from "./shipped-account.js";

test("packaged account credentials fill an otherwise clean launch", () => {
  const environment: NodeJS.ProcessEnv = {};
  applyShippedAccountCredentials(environment, {
    POLYMUX_SUPABASE_URL: "https://example.supabase.co",
    POLYMUX_SUPABASE_ANON_KEY: "anon",
  });

  assert.equal(environment.POLYMUX_SUPABASE_URL, "https://example.supabase.co");
  assert.equal(environment.POLYMUX_SUPABASE_ANON_KEY, "anon");
});

test("an explicit launch override wins over the packaged account credentials", () => {
  const environment: NodeJS.ProcessEnv = {
    POLYMUX_SUPABASE_URL: "https://override.supabase.co",
  };
  applyShippedAccountCredentials(environment, {
    POLYMUX_SUPABASE_URL: "https://packaged.supabase.co",
    POLYMUX_SUPABASE_ANON_KEY: "packaged",
  });

  assert.equal(environment.POLYMUX_SUPABASE_URL, "https://override.supabase.co");
  assert.equal(environment.POLYMUX_SUPABASE_ANON_KEY, "packaged");
});

test("blank packaged account values never create misleading configuration", () => {
  const environment: NodeJS.ProcessEnv = {};
  applyShippedAccountCredentials(environment, {
    POLYMUX_SUPABASE_URL: "  ",
    POLYMUX_SUPABASE_ANON_KEY: "",
  });

  assert.equal(environment.POLYMUX_SUPABASE_URL, undefined);
  assert.equal(environment.POLYMUX_SUPABASE_ANON_KEY, undefined);
});
