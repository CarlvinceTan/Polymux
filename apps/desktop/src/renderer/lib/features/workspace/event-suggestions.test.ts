import assert from 'node:assert/strict';
import test from 'node:test';
import type {CalendarEventDto} from '@polymux/protocol';
import {
  buildSuggestionInput,
  collectSuggestionInputs,
  dedupeSuggestionsAgainstEvents,
  extractEventSuggestions,
  filterDismissed,
  mergeDuplicateSuggestions,
  titlesMatch,
  type SuggestionInput,
} from './event-suggestions.js';

const NOW = new Date(2026, 8, 17, 12, 0, 0);

function input(text: string, overrides: Partial<SuggestionInput> = {}): SuggestionInput {
  return {
    id: 'in-1',
    kind: 'message',
    label: 'WhatsApp with Maya',
    text,
    sentAt: new Date(2026, 8, 17, 9, 0, 0).toISOString(),
    ...overrides,
  };
}

function existing(title: string, start: Date, end: Date): CalendarEventDto {
  return {
    id: 'event-1',
    calendarId: 'cal-1',
    title,
    start: start.toISOString(),
    end: end.toISOString(),
    allDay: false,
    availability: 'busy',
    attendees: [],
    editable: true,
  };
}

test('extracts a timed dinner with location and full metadata', () => {
  const [suggestion] = extractEventSuggestions(
    [input('Dinner with Maya tomorrow at 7pm at Marina Bay Sands?')],
    NOW,
  );
  assert.ok(suggestion);
  assert.equal(suggestion.title.toLowerCase().includes('dinner'), true);
  assert.equal(suggestion.allDay, false);
  assert.equal(new Date(suggestion.start).getDate(), 18);
  assert.equal(new Date(suggestion.start).getHours(), 19);
  assert.equal(suggestion.location, 'Marina Bay Sands');
  assert.ok(suggestion.confidence >= 0.5);
  assert.ok(suggestion.notes?.includes('WhatsApp with Maya'));
  const eventInput = buildSuggestionInput(suggestion, 'cal-1');
  assert.equal(eventInput.calendarId, 'cal-1');
  assert.equal(eventInput.title, suggestion.title);
  assert.equal(eventInput.availability, 'busy');
  assert.equal(eventInput.alarmMinutes, 15);
});

test('extracts a flight with its code as the title', () => {
  const [suggestion] = extractEventSuggestions(
    [input('Your flight SQ637 to Tokyo on Sep 20 at 9:15am is confirmed. Check in at Changi T3.', {
      kind: 'email',
      label: 'Email from singaporeair@sia.com',
    })],
    NOW,
  );
  assert.ok(suggestion);
  assert.ok(suggestion.title.includes('SQ637'));
  assert.equal(new Date(suggestion.start).getMonth(), 8);
  assert.equal(new Date(suggestion.start).getDate(), 20);
});

test('keeps date-only events as all-day with free availability', () => {
  const [suggestion] = extractEventSuggestions(
    [input('Wedding of Jonas and Priya on 10 October! Hope you can make it.')],
    NOW,
  );
  assert.ok(suggestion);
  assert.equal(suggestion.allDay, true);
  assert.equal(suggestion.availability, 'free');
});

test('ignores vague plans with no date', () => {
  assert.deepEqual(extractEventSuggestions([input("Let's do dinner soon!")], NOW), []);
});

test('drops stale suggestions but keeps the one-day grace window', () => {
  assert.deepEqual(
    extractEventSuggestions([input('Dinner last Monday at 7pm was great, thanks!')], NOW),
    [],
  );
});

test('dedupes against an existing calendar event', () => {
  const suggestions = extractEventSuggestions([input('Dinner with Maya tomorrow at 7pm')], NOW);
  assert.equal(suggestions.length, 1);
  const duplicate = existing('Dinner with Maya', new Date(2026, 8, 18, 19, 5, 0), new Date(2026, 8, 18, 20, 5, 0));
  assert.deepEqual(dedupeSuggestionsAgainstEvents(suggestions, [duplicate]), []);
  const other = existing('Dentist appointment', new Date(2026, 8, 18, 19, 0, 0), new Date(2026, 8, 18, 20, 0, 0));
  assert.equal(dedupeSuggestionsAgainstEvents(suggestions, [other]).length, 1);
});

test('merges the same event seen in two chats', () => {
  const merged = mergeDuplicateSuggestions([
    ...extractEventSuggestions([input('Dinner with Maya tomorrow at 7pm', {id: 'a'})], NOW),
    ...extractEventSuggestions([input('Dinner with Maya tomorrow at 7pm!', {id: 'b', label: 'Telegram with Maya'})], NOW),
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.alsoSeen, 2);
});

test('dismissed suggestions stay dismissed by stable id', () => {
  const suggestions = extractEventSuggestions([input('Dinner with Maya tomorrow at 7pm')], NOW);
  const dismissed = new Set([suggestions[0]!.id]);
  assert.deepEqual(filterDismissed(suggestions, dismissed), []);
  // A rescan produces the same stable id, so the dismissal survives.
  const rescanned = extractEventSuggestions([input('Dinner with Maya tomorrow at 7pm!', {id: 'other'})], NOW);
  assert.equal(rescanned[0]?.id, suggestions[0]?.id);
});

test('titles match across small wording differences', () => {
  assert.equal(titlesMatch('Dinner with Maya', 'dinner with maya!'), true);
  assert.equal(titlesMatch('Team standup', 'Dentist appointment'), false);
});

test('collects bounded inputs without marking anything read', async () => {
  const reader = {
    chats: async () => [
      {id: 'chat-1', name: 'Maya', platform: 'WhatsApp', lastActivity: NOW.toISOString()},
      {id: 'chat-old', name: 'Old', platform: 'Telegram', lastActivity: new Date(2026, 0, 1).toISOString()},
    ],
    chatMessages: async (chatId: string) => ({
      messages: chatId === 'chat-1'
        ? [{id: 'm1', body: 'Dinner tomorrow at 7pm?', sentAt: NOW.toISOString()}]
        : [],
    }),
    status: async () => ({email: {accounts: []}}),
    mailEnvelopes: async () => [],
    mailMessage: async () => ({subject: '', body: '', date: NOW.toISOString()}),
  };
  const inputs = await collectSuggestionInputs(reader, NOW, {maxChats: 5});
  assert.equal(inputs.length, 1);
  assert.equal(inputs[0]?.label, 'WhatsApp with Maya');
});
