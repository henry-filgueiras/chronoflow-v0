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

export type SemanticLaneId = 'payment' | 'inventory' | 'shipment' | 'cancellation' | 'reconciliation';

export interface SemanticLane {
  id: SemanticLaneId;
  label: string;
  top: number;
  center: number;
  height: number;
}

export interface TimeBand {
  index: number;
  x: number;
  width: number;
}

export interface GraphNode {
  event: EventRecord;
  x: number;
  y: number;
  laneId: SemanticLaneId;
  clusterId: string;
  contradictionCount: number;
  stackIndex: number;
}

export interface GraphCluster {
  id: string;
  flowId: string;
  laneId: SemanticLaneId;
  x1: number;
  x2: number;
  y: number;
  height: number;
  eventCount: number;
  contradictionCount: number;
}

export interface GraphEdge {
  id: string;
  sourceId: string;
  targetId: string;
  kind: 'causal' | 'sequence';
}

export interface GraphLayout {
  nodes: GraphNode[];
  edges: GraphEdge[];
  lanes: SemanticLane[];
  clusters: GraphCluster[];
  width: number;
  height: number;
  bounds: TimeBounds;
}

export interface DemoScenario {
  id: string;
  name: string;
  description: string;
  events: EventRecord[];
}
