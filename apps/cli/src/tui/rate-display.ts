/** Presentation only: quickly ease toward the latest measured speed. */
export class RateDisplay {
  value: number | null = null;
  reset() {
    this.value = null;
  }
  step(target: number | null): boolean {
    if (target === null || !Number.isFinite(target)) return false;
    const goal = Math.max(0, Math.round(target));
    // At 25ms per tick, close 30% of the remaining gap in either direction.
    // Large changes catch up quickly; small changes settle without a long tail.
    const gap = goal - (this.value ?? 0);
    const next =
      this.value === null
        ? Math.min(1, goal)
        : this.value + Math.sign(gap) * Math.ceil(Math.abs(gap) * 0.3);
    if (next === this.value) return false;
    this.value = next;
    return true;
  }
}
