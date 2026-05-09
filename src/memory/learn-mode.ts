import type { AgentAction } from '../types';

export class LearnMode {
  private active = false;
  private recorded: AgentAction[] = [];

  start(): void {
    this.active = true;
    this.recorded = [];
    // TODO: attach listeners to capture click/input/navigation events
  }

  stop(): AgentAction[] {
    this.active = false;
    // TODO: detach listeners
    return this.recorded;
  }

  isActive(): boolean {
    return this.active;
  }
}
