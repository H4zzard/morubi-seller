export class WorkerRuntime {
  private stopping = false;
  private currentCycle: Promise<void> | null = null;

  public constructor(
    private readonly cycle: () => Promise<void>,
    private readonly pollIntervalMs: number
  ) {}

  public async start(): Promise<void> {
    while (!this.stopping) {
      this.currentCycle = this.cycle();
      await this.currentCycle;
      this.currentCycle = null;
      if (!this.stopping) await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
    }
  }

  public async stop(): Promise<void> {
    this.stopping = true;
    await this.currentCycle;
  }
}
