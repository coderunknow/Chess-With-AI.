import assert from "node:assert/strict";
import test from "node:test";

import { getDictionary } from "../src/shared/i18n.js";
import { DEFAULT_SETTINGS, mergeSettings, normaliseSettings } from "../src/shared/settings.js";

test("v0.6 settings ship with safe, bounded defaults", () => {
  assert.equal(DEFAULT_SETTINGS.interfaceDetail, "simple");
  assert.equal(DEFAULT_SETTINGS.boardOrientation, "follow-side");
  assert.equal(DEFAULT_SETTINGS.moveListFormat, "san");
  assert.equal(DEFAULT_SETTINGS.moveInteraction, "tap-drag");
  assert.equal(DEFAULT_SETTINGS.confirmDestructive, true);
  assert.equal(DEFAULT_SETTINGS.waitingReminderMs, 0);

  // Defaults must survive a plain normalise with no stored data.
  const fresh = normaliseSettings(undefined);
  assert.equal(fresh.interfaceDetail, DEFAULT_SETTINGS.interfaceDetail);
  assert.equal(fresh.waitingReminderMs, 0);
  assert.equal(fresh.confirmDestructive, true);
});

test("corrupt stored values fall back to defaults, never throw", () => {
  const repaired = normaliseSettings({
    interfaceDetail: "chaos",
    boardOrientation: 42,
    moveListFormat: "fen",
    moveInteraction: "telepathy",
    confirmDestructive: "yes",
    waitingReminderMs: 45_000, // not one of the bounded choices
  });
  assert.equal(repaired.interfaceDetail, "simple");
  assert.equal(repaired.boardOrientation, "follow-side");
  assert.equal(repaired.moveListFormat, "san");
  assert.equal(repaired.moveInteraction, "tap-drag");
  assert.equal(repaired.confirmDestructive, true);
  assert.equal(repaired.waitingReminderMs, 0);

  // Out-of-range reminder and negative delay also fall back.
  assert.equal(normaliseSettings({ waitingReminderMs: 999_999 }).waitingReminderMs, 0);
  assert.equal(normaliseSettings({ waitingReminderMs: -1 }).waitingReminderMs, 0);
});

test("old v0.5 storage keeps its values while new keys gain defaults", () => {
  const oldSnapshot = {
    // A realistic pre-0.6 stored object: no v0.6 keys at all.
    locale: "vi",
    engineLevel: 7,
    soundEnabled: false,
    autoRetry: false,
    clockDurationMs: 3 * 60_000,
    sendMode: "manual",
    paused: true,
  };
  const merged = mergeSettings(oldSnapshot);
  assert.equal(merged.locale, "vi");
  assert.equal(merged.engineLevel, 7);
  assert.equal(merged.soundEnabled, false);
  assert.equal(merged.clockDurationMs, 180_000);
  assert.equal(merged.sendMode, "manual");
  assert.equal(merged.paused, true);
  // New keys appear with defaults…
  assert.equal(merged.interfaceDetail, "simple");
  assert.equal(merged.boardOrientation, "follow-side");
  assert.equal(merged.moveListFormat, "san");
  assert.equal(merged.moveInteraction, "tap-drag");
  assert.equal(merged.confirmDestructive, true);
  assert.equal(merged.waitingReminderMs, 0);
  // …and a valid patch still overrides one without disturbing the rest.
  const patched = mergeSettings({ waitingReminderMs: 60_000 }, merged);
  assert.equal(patched.waitingReminderMs, 60_000);
  assert.equal(patched.interfaceDetail, "simple");
  assert.equal(patched.locale, "vi");
});

test("reset-to-defaults restores every v0.6 key", () => {
  const custom = mergeSettings({
    interfaceDetail: "advanced",
    boardOrientation: "black",
    moveListFormat: "uci",
    moveInteraction: "drag",
    confirmDestructive: false,
    waitingReminderMs: 120_000,
  });
  const reset = mergeSettings(DEFAULT_SETTINGS, custom);
  assert.deepEqual(
    {
      interfaceDetail: reset.interfaceDetail,
      boardOrientation: reset.boardOrientation,
      moveListFormat: reset.moveListFormat,
      moveInteraction: reset.moveInteraction,
      confirmDestructive: reset.confirmDestructive,
      waitingReminderMs: reset.waitingReminderMs,
    },
    {
      interfaceDetail: DEFAULT_SETTINGS.interfaceDetail,
      boardOrientation: DEFAULT_SETTINGS.boardOrientation,
      moveListFormat: DEFAULT_SETTINGS.moveListFormat,
      moveInteraction: DEFAULT_SETTINGS.moveInteraction,
      confirmDestructive: DEFAULT_SETTINGS.confirmDestructive,
      waitingReminderMs: DEFAULT_SETTINGS.waitingReminderMs,
    },
  );
});

test("every new setting label exists in both locales", () => {
  const en = getDictionary("en");
  const vi = getDictionary("vi");
  const keys = [
    "settings.groupInterface",
    "settings.interfaceDetail",
    "settings.interfaceSimple",
    "settings.interfaceAdvanced",
    "settings.boardOrientation",
    "settings.orientationFollow",
    "settings.orientationWhite",
    "settings.orientationBlack",
    "settings.moveListFormat",
    "settings.moveListSan",
    "settings.moveListUci",
    "settings.moveInteraction",
    "settings.interactionTapDrag",
    "settings.interactionTap",
    "settings.interactionDrag",
    "settings.confirmDestructive",
    "settings.confirmDestructiveHint",
    "settings.waitingReminder",
    "settings.reminderOff",
    "settings.reminderShort",
    "settings.reminderMedium",
    "settings.reminderLong",
    "settings.reminderHint",
    "firstRun.text",
    "firstRun.dismiss",
    "help.title",
    "help.pinnedChat",
    "help.localTools",
    "help.rated",
    "chip.pinned",
    "chip.none",
    "play.youPlay",
    "moves.empty",
    "more.title",
    "tools.title",
    "delivery.title",
    "delivery.neverAttempted",
    "delivery.attempted",
    "delivery.confirmed",
    "delivery.answered",
    "delivery.stale",
    "status.submitUnconfirmed",
    "status.stillWaiting",
    "status.checkChat",
    "controls.confirmReplaceGame",
    "match.ratedSection",
    "match.banner",
  ];
  for (const key of keys) {
    assert.ok(en[key], `missing en: ${key}`);
    assert.ok(vi[key], `missing vi: ${key}`);
    assert.ok(String(vi[key]).trim().length > 0, `empty vi: ${key}`);
  }
});
