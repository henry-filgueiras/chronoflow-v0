import {
  ConflictHeatBand,
  ContradictionSeverity,
  EventRecord,
  EventType,
  GraphEdge,
  GraphLayout,
  GraphNode,
  SemanticLane,
  SemanticLaneId,
  TimeBand,
  TimeBounds,
  TimelineSparkline,
} from '../types';
import { groupEventsByFlow, sortEvents } from './engine';

const GRAPH_WIDTH = 1600;
const LEFT_GUTTER = 232;
const RIGHT_GUTTER = 88;
const SPARKLINE_TOP = 18;
const SPARKLINE_HEIGHT = 34;
const TIMELINE_TOP = 84;
const LANE_GAP = 14;
const LANE_HEADER = 18;
const SLOT_HEIGHT = 56;
const SLOT_GAP = 8;
const SLOT_Y_OFFSET = 16;
const STACK_STEP = 14;
const EVENT_WIDTH = 132;
const EVENT_HEIGHT = 22;
const MAX_STACKS = 3;
const MIN_SPAN = 10 * 60 * 1000;
const HEAT_BINS = 24;

const semanticLaneCatalog: Array<{ id: SemanticLaneId; label: string }> = [
  { id: 'payment', label: 'Payment' },
  { id: 'inventory', label: 'Inventory' },
  { id: 'shipment', label: 'Shipment' },
  { id: 'cancellation', label: 'Cancellation' },
  { id: 'reconciliation', label: 'Reconciliation' },
];

const semanticLaneByType: Record<EventType, SemanticLaneId> = {
  ORDER_CREATED: 'inventory',
  INVENTORY_RESERVED: 'inventory',
  PAYMENT_AUTHORIZED: 'payment',
  PAYMENT_FAILED: 'payment',
  PACKING_STARTED: 'inventory',
  PACKED: 'inventory',
  SHIPPED: 'shipment',
  DELIVERY_CONFIRMED: 'shipment',
  CANCELED: 'cancellation',
  RETURN_INITIATED: 'reconciliation',
};

type RawNode = Omit<GraphNode, 'y' | 'width' | 'height' | 'slotIndex' | 'severity' | 'stackIndex'>;

export const GRAPH_LEFT_GUTTER = LEFT_GUTTER;

const severityWeight: Record<ContradictionSeverity | 'none', number> = {
  none: 0,
  medium: 1.2,
  high: 2.1,
};

export const getTimeBounds = (events: EventRecord[]): TimeBounds => {
  const ordered = sortEvents(events);

  if (ordered.length === 0) {
    const now = Date.now();
    return { min: now, max: now + MIN_SPAN, span: MIN_SPAN };
  }

  const timestamps = ordered.map((event) => new Date(event.ts).getTime());
  const min = Math.min(...timestamps);
  const max = Math.max(...timestamps);
  const span = Math.max(max - min, MIN_SPAN);

  return { min, max, span };
};

export const getSemanticLaneForEvent = (type: EventType) => semanticLaneByType[type];

const buildSparkline = (
  values: number[],
  usableWidth: number,
): { heatBands: ConflictHeatBand[]; sparkline: TimelineSparkline } => {
  const bandWidth = usableWidth / HEAT_BINS;
  const maxValue = Math.max(...values, 0);
  const baseY = SPARKLINE_TOP + SPARKLINE_HEIGHT;

  const points = values.map((value, index) => {
    const x = LEFT_GUTTER + index * bandWidth + bandWidth / 2;
    const y =
      maxValue === 0 ? baseY - 2 : baseY - 2 - (value / maxValue) * Math.max(10, SPARKLINE_HEIGHT - 10);

    return { x, y, value };
  });

  const linePath =
    points.length === 0
      ? `M ${LEFT_GUTTER} ${baseY - 2} L ${LEFT_GUTTER + usableWidth} ${baseY - 2}`
      : points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');

  const areaPath =
    points.length === 0
      ? `M ${LEFT_GUTTER} ${baseY - 2} L ${LEFT_GUTTER + usableWidth} ${baseY - 2} L ${LEFT_GUTTER + usableWidth} ${baseY} L ${LEFT_GUTTER} ${baseY} Z`
      : [
          `M ${points[0].x} ${baseY}`,
          ...points.map((point) => `L ${point.x} ${point.y}`),
          `L ${points[points.length - 1].x} ${baseY}`,
          'Z',
        ].join(' ');

  const heatBands = values
    .map((value, index) => ({
      index,
      x: LEFT_GUTTER + index * bandWidth,
      width: bandWidth,
      value,
      intensity: maxValue === 0 ? 0 : value / maxValue,
    }))
    .filter((band) => band.value > 0 && band.intensity > 0.16);

  return {
    heatBands,
    sparkline: {
      areaPath,
      linePath,
      maxValue,
    },
  };
};

export const buildGraphLayout = (
  events: EventRecord[],
  contradictionCounts: Map<string, number>,
  eventSeverities: Map<string, ContradictionSeverity>,
): GraphLayout => {
  const ordered = sortEvents(events);
  const bounds = getTimeBounds(events);
  const usableWidth = GRAPH_WIDTH - LEFT_GUTTER - RIGHT_GUTTER;

  const flowOrderByLane = new Map<SemanticLaneId, string[]>();
  semanticLaneCatalog.forEach((lane) => flowOrderByLane.set(lane.id, []));

  for (const event of events) {
    const laneId = getSemanticLaneForEvent(event.type);
    const flows = flowOrderByLane.get(laneId)!;
    if (!flows.includes(event.flowId)) {
      flows.push(event.flowId);
    }
  }

  let currentTop = TIMELINE_TOP;
  const lanes: SemanticLane[] = semanticLaneCatalog.map((lane) => {
    const flowIds = flowOrderByLane.get(lane.id) ?? [];
    const slots = (flowIds.length === 0 ? [''] : flowIds).map((flowId, index) => {
      const top = currentTop + LANE_HEADER + index * (SLOT_HEIGHT + SLOT_GAP);
      return {
        flowId,
        top,
        center: top + SLOT_Y_OFFSET,
        height: SLOT_HEIGHT,
        index,
      };
    });

    const height = LANE_HEADER + slots.length * SLOT_HEIGHT + Math.max(0, slots.length - 1) * SLOT_GAP + 14;
    const laneLayout = {
      id: lane.id,
      label: lane.label,
      top: currentTop,
      center: currentTop + height / 2,
      height,
      slots,
    };

    currentTop += height + LANE_GAP;
    return laneLayout;
  });

  const slotLookup = new Map<string, number>();
  lanes.forEach((lane) => {
    lane.slots.forEach((slot) => {
      if (slot.flowId) {
        slotLookup.set(`${lane.id}:${slot.flowId}`, slot.index);
      }
    });
  });

  const rawNodes: RawNode[] = ordered.map((event) => {
    const laneId = getSemanticLaneForEvent(event.type);
    const offset = new Date(event.ts).getTime() - bounds.min;

    return {
      event,
      x: LEFT_GUTTER + (offset / bounds.span) * usableWidth,
      laneId,
      clusterId: `${laneId}:${event.flowId}`,
      contradictionCount: contradictionCounts.get(event.id) ?? 0,
    };
  });

  const stackIndexByEventId = new Map<string, number>();
  const groupedBySlot = new Map<string, RawNode[]>();

  rawNodes.forEach((node) => {
    const key = `${node.laneId}:${node.event.flowId}`;
    const bucket = groupedBySlot.get(key) ?? [];
    bucket.push(node);
    groupedBySlot.set(key, bucket);
  });

  groupedBySlot.forEach((slotNodes) => {
    const sortedNodes = [...slotNodes].sort((left, right) => left.x - right.x);
    const lastEndByStack = Array.from({ length: MAX_STACKS }, () => -Infinity);

    sortedNodes.forEach((node) => {
      const freeStack = lastEndByStack.findIndex((endX) => node.x > endX + 10);
      const stackIndex = freeStack === -1 ? MAX_STACKS - 1 : freeStack;
      lastEndByStack[stackIndex] = node.x + EVENT_WIDTH;
      stackIndexByEventId.set(node.event.id, stackIndex);
    });
  });

  const laneLookup = new Map(lanes.map((lane) => [lane.id, lane]));

  const nodes: GraphNode[] = rawNodes.map((node) => {
    const lane = laneLookup.get(node.laneId)!;
    const slotIndex = slotLookup.get(`${node.laneId}:${node.event.flowId}`) ?? 0;
    const slot = lane.slots[slotIndex] ?? lane.slots[0];
    const stackIndex = stackIndexByEventId.get(node.event.id) ?? 0;

    return {
      ...node,
      y: slot.top + SLOT_Y_OFFSET + stackIndex * STACK_STEP,
      width: EVENT_WIDTH,
      height: EVENT_HEIGHT,
      slotIndex,
      stackIndex,
      severity: eventSeverities.get(node.event.id) ?? 'none',
    };
  });

  const edges: GraphEdge[] = [];
  const byFlow = groupEventsByFlow(events);

  for (const flowEvents of byFlow.values()) {
    flowEvents.forEach((event, index) => {
      const previous = flowEvents[index - 1];
      if (previous) {
        edges.push({
          id: `seq-${previous.id}-${event.id}`,
          sourceId: previous.id,
          targetId: event.id,
          kind: 'sequence' as const,
        });
      }

      event.causalityRefs.forEach((sourceId) => {
        edges.push({
          id: `cause-${sourceId}-${event.id}`,
          sourceId,
          targetId: event.id,
          kind: 'causal' as const,
        });
      });
    });
  }

  const heatValues = Array.from({ length: HEAT_BINS }, () => 0);

  ordered.forEach((event) => {
    const contradictionCount = contradictionCounts.get(event.id) ?? 0;
    if (contradictionCount === 0) {
      return;
    }

    const severity = eventSeverities.get(event.id) ?? 'none';
    const weight = contradictionCount * severityWeight[severity];
    const normalized = bounds.span === 0 ? 0 : (new Date(event.ts).getTime() - bounds.min) / bounds.span;
    const index = Math.min(HEAT_BINS - 1, Math.max(0, Math.floor(normalized * HEAT_BINS)));
    heatValues[index] += weight;
  });

  const { heatBands, sparkline } = buildSparkline(heatValues, usableWidth);

  return {
    nodes,
    edges,
    lanes,
    clusters: [],
    heatBands,
    sparkline,
    width: GRAPH_WIDTH,
    height: Math.max(480, currentTop + 24),
    bounds,
    sparklineTop: SPARKLINE_TOP,
    sparklineHeight: SPARKLINE_HEIGHT,
    timelineTop: TIMELINE_TOP,
    timelineBottom: currentTop + 10,
  };
};

export const formatAxisLabel = (timestamp: number) =>
  new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

export const buildTicks = (bounds: TimeBounds, count = 6) => {
  const step = bounds.span / (count - 1);
  const usableWidth = GRAPH_WIDTH - LEFT_GUTTER - RIGHT_GUTTER;

  return Array.from({ length: count }, (_, index) => {
    const value = bounds.min + step * index;
    return {
      value,
      label: formatAxisLabel(value),
      x: LEFT_GUTTER + ((value - bounds.min) / bounds.span) * usableWidth,
    };
  });
};

export const buildTimeBands = (bounds: TimeBounds, count = 8): TimeBand[] => {
  const step = bounds.span / count;
  const usableWidth = GRAPH_WIDTH - LEFT_GUTTER - RIGHT_GUTTER;

  return Array.from({ length: count }, (_, index) => {
    const start = bounds.min + step * index;
    const end = start + step;

    return {
      index,
      x: LEFT_GUTTER + ((start - bounds.min) / bounds.span) * usableWidth,
      width: ((end - start) / bounds.span) * usableWidth,
    };
  });
};
