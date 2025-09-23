import { EventEmitter } from 'events';

export interface TodayVisitorUpdate {
  total: number;
  generated_at: string; // ISO timestamp when emitted
}

export const visitorEvents = new EventEmitter();
// Allow unlimited listeners (SSE clients) without warning
visitorEvents.setMaxListeners(0);

export function emitTodayVisitor(total: number) {
  const payload: TodayVisitorUpdate = { total, generated_at: new Date().toISOString() };
  visitorEvents.emit('today', payload);
}
