export type EventType =
  | 'ORDER_CREATED'
  | 'INVENTORY_RESERVED'
  | 'PAYMENT_AUTHORIZED'
  | 'PAYMENT_FAILED'
  | 'PACKING_STARTED'
  | 'PACKED'
  | 'SHIPPED'
  | 'DELIVERY_CONFIRMED'
  | 'CANCELED'
  | 'RETURN_INITIATED';

export interface EventRecord {
  id: string;
  flowId: string;
  ts: string;
  type: EventType;
  payload: Record<string, unknown>;
  causalityRefs: string[];
}

export interface HypothesisNode {
  id: string;
  proposition: string;
  validFrom: string;
  validTo?: string;
  confidence: number;
}

export interface ConstraintRule {
  name: string;
  when: EventType;
  requires?: string[];
  forbids?: string[];
}

export interface DerivedHypothesis extends HypothesisNode {
  flowId: string;
  sourceEventId: string;
  kind: 'state' | 'alert';
}

export type ContradictionSeverity = 'high' | 'medium';

export interface ReconciliationSuggestion {
  id: string;
  title: string;
  detail: string;
}

export interface Contradiction {
  id: string;
  flowId: string;
  title: string;
  summary: string;
  severity: ContradictionSeverity;
  relatedEventIds: string[];
  brokenRule: string;
  evidence: string[];
  suggestions: ReconciliationSuggestion[];
}

export interface EventFormState {
  flowId: string;
  ts: string;
  type: EventType;
  payload: string;
  causalityRefs: string;
}

export interface TimeBounds {
  min: number;
  max: number;
  span: number;
}

export interface GraphNode {
  event: EventRecord;
  x: number;
  y: number;
  lane: number;
  contradictionCount: number;
}

export interface GraphEdge {
  id: string;
  sourceId: string;
  targetId: string;
  kind: 'causal' | 'sequence';
}
