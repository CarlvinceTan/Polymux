/** Active-stream estimate, not request throughput. Pauses cannot decay the rate. */
export class GenerationRate {
  rate: number | null = null;
  private key = "";
  private ratios = new Map<string, number>();
  private last: number | null = null;
  private chars = 0;
  private measuredChars = 0;
  private activeMs = 0;
  private pendingChars = 0;
  private pendingMs = 0;
  private gaps: number[] = [];

  start(key: string) {
    if (key !== this.key) this.rate = null;
    this.key = key;
    this.last = null;
    this.chars = this.measuredChars = this.activeMs = 0;
    this.pendingChars = this.pendingMs = 0;
    this.gaps = [];
  }

  add(delta: string, now: number) {
    if (!delta) return;
    this.chars += delta.length;
    if (this.last !== null) {
      const gap = Math.max(0, now - this.last);
      const sorted = [...this.gaps].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)] ?? 200;
      // Adapt to normally batched streams; reject exceptional delivery gaps.
      const pause = gap > Math.max(1500, median * 6);
      if (!pause) {
        this.pendingChars += delta.length;
        this.pendingMs += gap;
        this.measuredChars += delta.length;
        this.activeMs += gap;
        if (gap > 0) {
          this.gaps.push(gap);
          if (this.gaps.length > 31) this.gaps.shift();
        }
        if (this.pendingMs >= 400) {
          const sample =
            this.pendingChars /
            (this.ratios.get(this.key) ?? 3.8) /
            (this.pendingMs / 1000);
          const weight = 1 - Math.exp(-this.pendingMs / 4000);
          this.rate =
            this.rate === null
              ? sample
              : this.rate + weight * (sample - this.rate);
          this.pendingChars = this.pendingMs = 0;
        }
      }
      // The first chunk after a pause has unknown generation timing. Do not
      // count it as instantaneous work or include its wait in the denominator.
    }
    this.last = now;
  }

  finish(output: number | undefined, calibrate: boolean) {
    // Usage is a final total, never a newly arrived chunk. Only calibrate APIs
    // whose streamed content represents their output (not reasoning summaries).
    if (
      !calibrate ||
      !Number.isFinite(output) ||
      !output ||
      output < 32 ||
      this.chars < 128 ||
      this.activeMs < 1000
    )
      return;
    const ratio = this.chars / output;
    if (ratio < 1 || ratio > 12) return;
    const old = this.ratios.get(this.key);
    this.ratios.set(
      this.key,
      old === undefined ? ratio : old * 0.75 + ratio * 0.25,
    );
    const measured = this.measuredChars / ratio / (this.activeMs / 1000);
    this.rate =
      this.rate === null ? measured : this.rate * 0.75 + measured * 0.25;
  }
}
