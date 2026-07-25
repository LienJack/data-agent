export interface Clock {
  now(): Date;
}

export class ManualClock implements Clock {
  private currentTimeMs: number;

  constructor(initialTime: Date | string | number = "2026-07-25T00:00:00.000Z") {
    const currentTimeMs =
      initialTime instanceof Date
        ? initialTime.getTime()
        : typeof initialTime === "string"
          ? Date.parse(initialTime)
          : initialTime;
    if (!Number.isFinite(currentTimeMs)) {
      throw new TypeError("ManualClock 的初始时间必须有效。");
    }
    this.currentTimeMs = currentTimeMs;
  }

  now(): Date {
    return new Date(this.currentTimeMs);
  }

  advanceBy(milliseconds: number): void {
    if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) {
      throw new TypeError("ManualClock 只能前进非负安全整数毫秒。");
    }
    this.currentTimeMs += milliseconds;
  }
}
