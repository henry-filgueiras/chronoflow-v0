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

export interface WorkflowDeclarationAst {
  kind: 'event' | 'state';
  name: string;
  line: number;
}

export interface RequiresRuleAst {
  kind: 'requires';
  target: string;
  source: string;
  line: number;
}

export interface ForbidsRuleAst {
  kind: 'forbids';
  target: string;
  source: string;
  line: number;
}

export interface ImpliesRuleAst {
  kind: 'implies';
  source: string;
  target: string;
  line: number;
}

export interface WithinRuleAst {
  kind: 'within';
  target: string;
  source: string;
  durationMs: number;
  durationRaw: string;
  line: number;
}

export type WorkflowRuleAst = RequiresRuleAst | ForbidsRuleAst | ImpliesRuleAst | WithinRuleAst;

export interface WorkflowAst {
  name: string;
  line: number;
  declarations: WorkflowDeclarationAst[];
  rules: WorkflowRuleAst[];
}

export interface WorkflowProgramAst {
  workflows: WorkflowAst[];
}

export interface WorkflowDslParseError {
  line: number;
  message: string;
}

export interface WorkflowDslParseResult {
  ast: WorkflowProgramAst | null;
  errors: WorkflowDslParseError[];
}

export interface WorkflowEventDeclaration {
  kind: 'event';
  name: string;
  eventType?: EventType;
}

export interface WorkflowStateDeclaration {
  kind: 'state';
  name: string;
}

export type WorkflowDeclaration = WorkflowEventDeclaration | WorkflowStateDeclaration;

export interface CompiledRequiresRule {
  kind: 'requires';
  workflowName: string;
  targetName: string;
  sourceName: string;
  targetEventType?: EventType;
  sourceEventType?: EventType;
  line: number;
}

export interface CompiledForbidsRule {
  kind: 'forbids';
  workflowName: string;
  targetName: string;
  sourceName: string;
  targetEventType?: EventType;
  sourceEventType?: EventType;
  line: number;
}

export interface CompiledImpliesRule {
  kind: 'implies';
  workflowName: string;
  sourceName: string;
  targetName: string;
  sourceEventType?: EventType;
  targetEventType?: EventType;
  targetKind: 'event' | 'state';
  line: number;
}

export interface CompiledWithinRule {
  kind: 'within';
  workflowName: string;
  targetName: string;
  sourceName: string;
  targetEventType?: EventType;
  sourceEventType?: EventType;
  durationMs: number;
  durationRaw: string;
  line: number;
}

export type CompiledWorkflowRule =
  | CompiledRequiresRule
  | CompiledForbidsRule
  | CompiledImpliesRule
  | CompiledWithinRule;

export interface CompiledWorkflowSemantics {
  ast: WorkflowProgramAst;
  declarations: WorkflowDeclaration[];
  rules: CompiledWorkflowRule[];
  warnings: string[];
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

export interface LaneSlot {
  flowId: string;
  top: number;
  center: number;
  height: number;
  index: number;
}

export interface SemanticLane {
  id: SemanticLaneId;
  label: string;
  top: number;
  center: number;
  height: number;
  slots: LaneSlot[];
}

export interface TimeBand {
  index: number;
  x: number;
  width: number;
}

export interface ConflictHeatBand {
  index: number;
  x: number;
  width: number;
  value: number;
  intensity: number;
}

export interface TimelineSparkline {
  areaPath: string;
  linePath: string;
  maxValue: number;
}

export interface GraphNode {
  event: EventRecord;
  x: number;
  y: number;
  width: number;
  height: number;
  laneId: SemanticLaneId;
  clusterId: string;
  contradictionCount: number;
  stackIndex: number;
  slotIndex: number;
  severity: ContradictionSeverity | 'none';
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
  heatBands: ConflictHeatBand[];
  sparkline: TimelineSparkline;
  width: number;
  height: number;
  bounds: TimeBounds;
  sparklineTop: number;
  sparklineHeight: number;
  timelineTop: number;
  timelineBottom: number;
}

export interface DemoScenario {
  id: string;
  name: string;
  description: string;
  events: EventRecord[];
}
