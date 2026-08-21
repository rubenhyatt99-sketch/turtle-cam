import sharp from "sharp";

/**
 * Détection de mouvement par différence d'images.
 *
 * Chaque image JPEG est réduite en niveaux de gris (par défaut 160x120), puis
 * comparée à la précédente. La moyenne des écarts est retirée avant seuillage :
 * un changement global de luminosité (nuage, allumage de la lampe chauffante,
 * bascule jour/nuit de la caméra) ne déclenche donc pas de faux positif.
 */
export class MotionDetector {
  constructor(options) {
    this.width = options.width ?? 160;
    this.height = options.height ?? 120;
    this.pixelThreshold = options.pixelThreshold ?? 18;
    this.ignoreGlobalShift = options.ignoreNightVisionSwitch !== false;
    this.warmupFrames = options.warmupFrames ?? 20;
    this.mask = options.mask ?? null;
    this.previous = null;
    this.framesSeen = 0;
  }

  /** Convertit une image JPEG en tableau de luminance à la taille d'analyse. */
  async #grayscale(jpeg) {
    const { data } = await sharp(jpeg)
      .removeAlpha()
      .greyscale()
      .resize(this.width, this.height, { fit: "fill" })
      .raw()
      .toBuffer({ resolveWithObject: true });
    return data;
  }

  /**
   * Analyse une image et renvoie `null` pendant la phase de chauffe, sinon
   * `{ percent, centroid, changed }` où `percent` est la part de pixels ayant
   * changé et `centroid` le barycentre du mouvement en coordonnées 0-1.
   */
  async analyze(jpeg) {
    const current = await this.#grayscale(jpeg);
    const previous = this.previous;
    this.previous = current;
    this.framesSeen += 1;
    if (!previous || this.framesSeen <= this.warmupFrames) return null;

    const total = current.length;
    let sumDiff = 0;
    for (let i = 0; i < total; i += 1) sumDiff += Math.abs(current[i] - previous[i]);
    const globalShift = this.ignoreGlobalShift ? sumDiff / total : 0;

    let changed = 0;
    let sumX = 0;
    let sumY = 0;
    let considered = 0;
    for (let i = 0; i < total; i += 1) {
      if (this.mask && this.mask[i]) continue;
      considered += 1;
      const diff = Math.abs(current[i] - previous[i]) - globalShift;
      if (diff > this.pixelThreshold) {
        changed += 1;
        sumX += i % this.width;
        sumY += Math.floor(i / this.width);
      }
    }

    const percent = considered > 0 ? (changed / considered) * 100 : 0;
    return {
      percent,
      changed,
      centroid:
        changed > 0
          ? { x: sumX / changed / this.width, y: sumY / changed / this.height }
          : null,
    };
  }

  /** Réinitialise la référence, par exemple après une coupure du flux. */
  reset() {
    this.previous = null;
    this.framesSeen = 0;
  }
}
