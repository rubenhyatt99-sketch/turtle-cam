/**
 * Analyse comportementale (v2).
 *
 * L'agent ne "reconnaît" pas la tortue : il suit le barycentre du mouvement et
 * la zone de l'enclos dans laquelle il se trouve. Comme la tortue est le seul
 * objet mobile de la scène, cela suffit à reconstruire une journée : sortie de
 * la maison, passages à la gamelle, bains, temps sous la lampe.
 *
 * Les transitions sont filtrées par un temps de maintien (`zoneDebounceSec`)
 * pour ignorer les allers-retours du barycentre entre deux zones voisines.
 */

const OUTSIDE = "dehors";

/** Jour local (YYYY-MM-DD) dans le fuseau configuré. */
export function localDay(ms, timezone) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date(ms));
}

function emptySummary(day) {
  return {
    day,
    firstMotionAt: null,
    lastMotionAt: null,
    wakeUpAt: null,
    bedTimeAt: null,
    meals: 0,
    mealTimes: [],
    zoneSeconds: {},
    activeSeconds: 0,
    clips: 0,
    events: [],
  };
}

export class BehaviorTracker {
  constructor({ behavior, zones, day }) {
    this.config = behavior;
    this.zones = zones;
    this.summary = emptySummary(day ?? localDay(Date.now(), behavior.timezone));

    this.currentZone = null;
    this.zoneSince = null;
    this.pendingZone = null;
    this.pendingSince = null;
    this.lastSampleAt = null;

    this.homeLeftAt = null;
    this.outingEmitted = false;
    this.homeEnteredAt = null;
    this.returnEmitted = false;
    this.lastMealAt = 0;
    /** Événement de séjour en cours, dont la durée est mise à jour à la sortie. */
    this.openStay = null;
  }

  /**
   * Enregistre une observation. `zone` est le nom de la zone contenant le
   * barycentre du mouvement (`null` = hors zones), `moving` indique si le seuil
   * de mouvement est franchi. Renvoie les événements nouvellement détectés.
   */
  observe(atMs, zone, moving) {
    const events = [];
    const deltaSec = this.lastSampleAt ? Math.min((atMs - this.lastSampleAt) / 1000, 10) : 0;
    this.lastSampleAt = atMs;

    if (moving) {
      this.summary.activeSeconds += deltaSec;
      this.summary.lastMotionAt = new Date(atMs).toISOString();
      if (!this.summary.firstMotionAt) {
        this.summary.firstMotionAt = this.summary.lastMotionAt;
        events.push(this.#event("reveil", atMs, 0, undefined, 0.6));
      }
    }

    const observed = zone ?? (moving ? OUTSIDE : this.currentZone);
    if (observed) {
      this.summary.zoneSeconds[observed] = (this.summary.zoneSeconds[observed] ?? 0) + deltaSec;
    }

    // Filtrage des transitions : une zone doit être tenue pour être adoptée.
    if (observed !== this.currentZone) {
      if (observed !== this.pendingZone) {
        this.pendingZone = observed;
        this.pendingSince = atMs;
      } else if (atMs - this.pendingSince >= this.config.zoneDebounceSec * 1000) {
        events.push(...this.#changeZone(this.currentZone, this.pendingZone, this.pendingSince));
        this.currentZone = this.pendingZone;
        this.zoneSince = this.pendingSince;
        this.pendingZone = null;
      }
    } else {
      this.pendingZone = null;
    }

    events.push(...this.#checkDurations(atMs));
    return events;
  }

  #changeZone(from, to, atMs) {
    const events = [];
    const { homeZone } = this.config;

    // Fin d'un séjour : on fige sa durée réelle.
    if (this.openStay) {
      this.openStay.durationSec = Math.round((atMs - this.openStay.startedMs) / 1000);
      this.openStay = null;
    }

    if (from === homeZone && to !== homeZone) {
      this.homeLeftAt = atMs;
      this.outingEmitted = false;
      this.homeEnteredAt = null;
    }
    if (to === homeZone && from !== homeZone) {
      this.homeEnteredAt = atMs;
      this.returnEmitted = false;
      this.homeLeftAt = null;
    }
    return events;
  }

  /** Événements déclenchés par la durée passée dans la zone courante. */
  #checkDurations(atMs) {
    const events = [];
    const { homeZone, foodZone, waterZone, baskZone } = this.config;
    const heldSec = this.zoneSince ? (atMs - this.zoneSince) / 1000 : 0;

    if (this.homeLeftAt && !this.outingEmitted && atMs - this.homeLeftAt >= this.config.minOutingSec * 1000) {
      this.outingEmitted = true;
      const event = this.#event("sortie_maison", this.homeLeftAt, 0, homeZone, 0.85);
      if (!this.summary.wakeUpAt) this.summary.wakeUpAt = event.at;
      events.push(event);
    }

    if (
      this.homeEnteredAt &&
      !this.returnEmitted &&
      atMs - this.homeEnteredAt >= this.config.minReturnSec * 1000
    ) {
      this.returnEmitted = true;
      const event = this.#event("retour_maison", this.homeEnteredAt, 0, homeZone, 0.85);
      this.summary.bedTimeAt = event.at;
      events.push(event);
    }

    const stays = [
      { zone: foodZone, kind: "repas", minSec: this.config.mealMinSec, cooldown: this.config.mealCooldownSec },
      { zone: waterZone, kind: "bain", minSec: this.config.bathMinSec, cooldown: 600 },
      { zone: baskZone, kind: "bronzage", minSec: this.config.baskMinSec, cooldown: 1800 },
    ];

    for (const stay of stays) {
      if (!stay.zone || this.currentZone !== stay.zone || heldSec < stay.minSec) continue;
      const already = this.openStay?.kind === stay.kind && this.openStay.startedMs === this.zoneSince;
      if (already) continue;
      const lastSame = [...this.summary.events].reverse().find((event) => event.kind === stay.kind);
      if (lastSame && this.zoneSince - new Date(lastSame.at).getTime() < stay.cooldown * 1000) continue;

      const event = this.#event(stay.kind, this.zoneSince, Math.round(heldSec), stay.zone, 0.75);
      event.startedMs = this.zoneSince;
      this.openStay = event;
      if (stay.kind === "repas") {
        this.summary.meals += 1;
        this.summary.mealTimes.push(event.at);
      }
      events.push(event);
    }

    return events;
  }

  #event(kind, atMs, durationSec, zone, confidence) {
    const event = { kind, at: new Date(atMs).toISOString(), durationSec, confidence };
    if (zone) event.zone = zone;
    this.summary.events.push(event);
    return event;
  }

  /** Rattache les événements d'une fenêtre temporelle au clip qui la couvre. */
  attachClip(clipId, startMs, endMs) {
    this.summary.clips += 1;
    for (const event of this.summary.events) {
      if (event.clipId) continue;
      const at = new Date(event.at).getTime();
      if (at >= startMs && at <= endMs) event.clipId = clipId;
    }
  }

  /**
   * Bascule sur un nouveau jour si nécessaire. Renvoie le résumé clos, ou
   * `null` si la journée est toujours en cours.
   */
  rolloverIfNeeded(nowMs) {
    const day = localDay(nowMs, this.config.timezone);
    if (day === this.summary.day) return null;
    const finished = this.serialize();
    this.summary = emptySummary(day);
    this.openStay = null;
    this.outingEmitted = false;
    this.returnEmitted = false;
    this.homeLeftAt = null;
    this.homeEnteredAt = null;
    return finished;
  }

  /** Résumé prêt à être écrit dans Drive (sans les champs internes). */
  serialize() {
    return {
      ...this.summary,
      activeSeconds: Math.round(this.summary.activeSeconds),
      zoneSeconds: Object.fromEntries(
        Object.entries(this.summary.zoneSeconds).map(([zone, seconds]) => [zone, Math.round(seconds)]),
      ),
      events: this.summary.events.map(({ startedMs, ...event }) => event),
    };
  }
}
