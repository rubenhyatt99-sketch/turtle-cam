import assert from "node:assert/strict";
import { test } from "node:test";
import { BehaviorTracker } from "../src/behavior.js";
import { pointInPolygon, zoneAt } from "../src/zones.js";

const behavior = {
  timezone: "Europe/Paris",
  homeZone: "maison",
  foodZone: "gamelle",
  waterZone: "bassin",
  baskZone: "lampe",
  zoneDebounceSec: 4,
  minOutingSec: 45,
  minReturnSec: 120,
  mealMinSec: 60,
  mealCooldownSec: 1800,
  bathMinSec: 90,
  baskMinSec: 300,
};

/** Rejoue une suite d'observations à raison d'une image toutes les 2 secondes. */
function replay(steps, startMs = Date.UTC(2026, 6, 1, 6, 0, 0)) {
  const tracker = new BehaviorTracker({ behavior, zones: [], day: "2026-07-01" });
  let at = startMs;
  const events = [];
  for (const step of steps) {
    for (let elapsed = 0; elapsed < step.seconds * 1000; elapsed += 2000) {
      events.push(...tracker.observe(at, step.zone, step.moving ?? true));
      at += 2000;
    }
  }
  return { tracker, events, endMs: at };
}

test("une sortie de la maison est détectée après le délai minimum", () => {
  const { events, tracker } = replay([
    { zone: "maison", seconds: 120 },
    { zone: "lampe", seconds: 120 },
  ]);

  const sortie = events.find((event) => event.kind === "sortie_maison");
  assert.ok(sortie, "l’événement sortie_maison doit être émis");
  assert.equal(tracker.summary.wakeUpAt, sortie.at);
});

test("un aller-retour bref ne compte pas comme une sortie", () => {
  const { events } = replay([
    { zone: "maison", seconds: 120 },
    { zone: "gamelle", seconds: 20 },
    { zone: "maison", seconds: 120 },
  ]);

  assert.equal(events.filter((event) => event.kind === "sortie_maison").length, 0);
});

test("un séjour prolongé à la gamelle est compté comme un repas", () => {
  const { events, tracker } = replay([
    { zone: "maison", seconds: 60 },
    { zone: "gamelle", seconds: 200 },
    { zone: "lampe", seconds: 60 },
  ]);

  const repas = events.filter((event) => event.kind === "repas");
  assert.equal(repas.length, 1);
  assert.equal(tracker.summary.meals, 1);
  assert.equal(tracker.summary.mealTimes.length, 1);
  // La durée est figée à la sortie de la zone.
  assert.ok(tracker.summary.events.find((event) => event.kind === "repas").durationSec >= 60);
});

test("deux passages à la gamelle dans la période de garde ne comptent qu’un repas", () => {
  const { tracker } = replay([
    { zone: "gamelle", seconds: 120 },
    { zone: "lampe", seconds: 120 },
    { zone: "gamelle", seconds: 120 },
  ]);

  assert.equal(tracker.summary.meals, 1);
});

test("le retour à la maison clôt la journée", () => {
  const { tracker } = replay([
    { zone: "maison", seconds: 60 },
    { zone: "bassin", seconds: 200 },
    { zone: "maison", seconds: 200 },
  ]);

  assert.ok(tracker.summary.bedTimeAt, "bedTimeAt doit être renseigné");
  assert.ok(tracker.summary.zoneSeconds.bassin > 100);
});

test("le changement de jour clôture le résumé", () => {
  const tracker = new BehaviorTracker({ behavior, zones: [], day: "2026-07-01" });
  tracker.observe(Date.UTC(2026, 6, 1, 10, 0, 0), "maison", true);
  const finished = tracker.rolloverIfNeeded(Date.UTC(2026, 6, 2, 10, 0, 0));

  assert.equal(finished.day, "2026-07-01");
  assert.equal(tracker.summary.day, "2026-07-02");
  assert.equal(tracker.summary.events.length, 0);
});

test("zoneAt localise un point dans le bon polygone", () => {
  const zones = [
    { name: "maison", polygon: [[0, 0], [0.4, 0], [0.4, 0.4], [0, 0.4]] },
    { name: "bassin", polygon: [[0.6, 0.6], [1, 0.6], [1, 1], [0.6, 1]] },
  ];

  assert.equal(zoneAt(0.2, 0.2, zones), "maison");
  assert.equal(zoneAt(0.8, 0.8, zones), "bassin");
  assert.equal(zoneAt(0.5, 0.5, zones), null);
  assert.equal(pointInPolygon(0.5, 0.5, zones[0].polygon), false);
});
