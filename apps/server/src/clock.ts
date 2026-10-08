/**
 * Operations clock. Equals wall-clock time, except in simulator mode where it can run faster
 * (SIM_SPEED / the speed control in the UI) to replay a working day.
 */
export class OpsClock {
  private realEpoch = Date.now();
  private opsEpoch = Date.now();
  speed = 1;

  now(): number {
    return this.opsEpoch + (Date.now() - this.realEpoch) * this.speed;
  }

  setSpeed(speed: number) {
    this.opsEpoch = this.now();
    this.realEpoch = Date.now();
    this.speed = Math.max(0, Math.min(600, speed));
  }

  snapshot() {
    return { realEpoch: this.realEpoch, opsEpoch: this.opsEpoch, speed: this.speed };
  }
}

export type ClockSnapshot = ReturnType<OpsClock['snapshot']>;
