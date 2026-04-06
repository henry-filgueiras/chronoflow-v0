import {
  EventRecord,
  EventType,
  GraphCluster,
  GraphEdge,
  GraphLayout,
  GraphNode,
  SemanticLane,
  SemanticLaneId,
  TimeBand,
  TimeBounds,
} from '../types';
import { groupEventsByFlow, sortEvents } from './engine';

const GRAPH_WIDTH = 1440;
const LEFT_GUTTER = 188;
const RIGHT_GUTTER = 96;
const GRAPH_TOP = 62;
const LANE_GAP = 18;
const MIN_SPAN = 10 * 60 * 1000;

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

type RawNode = Omit<GraphNode, 'y' | 'stackIndex'>;

export const GRAPH_LEFT_GUTTER = LEFT_GUTTER;

export const getTimeBounds = (events: EventRecord[]): TimeBounds => {
  const ordered = sortEvents(events);
  const timestamps = ordered.map((event) => new Date(event.ts).getTime());
  const min = Math.min(...timestamps);
  const max = Math.max(...timestamps);
  const span = Math.max(max - min, MIN_SPAN);

  return { min, max, span };
};

export const getSemanticLaneForEvent = (type: EventType) => semanticLaneByType[type];

export const buildGraphLayout = (events: EventRecord[], contradictionCounts: Map<string, number>): GraphLayout => {
  const ordered = sortEvents(events);
  const bounds = getTimeBounds(events);
  const usableWidth = GRAPH_WIDTH - LEFT_GUTTER - RIGHT_GUTTER;

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

  const clusterNodeLookup = new Map<string, RawNode[]>();
  rawNodes.forEach((node) => {
    const bucket = clusterNodeLookup.get(node.clusterId) ?? [];
    bucket.push(node);
    clusterNodeLookup.set(node.clusterId, bucket);
  });

  const stackIndexByEventId = new Map<string, number>();
  const clusterMetrics = new Map<
    string,
    {
      flowId: string;
      laneId: SemanticLaneId;
      x1: number;
      x2: number;
      stackCount: number;
      eventCount: number;
      contradictionCount: number;
    }
  >();

  clusterNodeLookup.forEach((clusterNodes, clusterId) => {
    const sortedNodes = [...clusterNodes].sort((left, right) => left.x - right.x);
    const lastXByStack: number[] = [];

    sortedNodes.forEach((node) => {
      let stackIndex = lastXByStack.findIndex((lastX) => node.x - lastX > 118);
      if (stackIndex === -1) {
        stackIndex = lastXByStack.length;
        lastXByStack.push(node.x);
      } else {
        lastXByStack[stackIndex] = node.x;
      }

      stackIndexByEventId.set(node.event.id, stackIndex);
    });

    clusterMetrics.set(clusterId, {
      flowId: sortedNodes[0].event.flowId,
      laneId: sortedNodes[0].laneId,
      x1: Math.max(LEFT_GUTTER - 4, Math.min(...sortedNodes.map((node) => node.x)) - 74),
      x2: Math.min(GRAPH_WIDTH - RIGHT_GUTTER + 28, Math.max(...sortedNodes.map((node) => node.x)) + 74),
      stackCount: Math.max(1, lastXByStack.length),
      eventCount: sortedNodes.length,
      contradictionCount: sortedNodes.reduce((sum, node) => sum + node.contradictionCount, 0),
    });
  });

  const clusterRowLookup = new Map<string, number>();
  const laneRowCount = new Map<SemanticLaneId, number>();
  const laneRowHeight = new Map<SemanticLaneId, number>();

  semanticLaneCatalog.forEach((lane) => {
    const laneClusters = Array.from(clusterMetrics.entries())
      .filter(([, cluster]) => cluster.laneId === lane.id)
      .sort((left, right) => left[1].x1 - right[1].x1);

    const rowEnds: number[] = [];
    let maxStackCount = 1;

    laneClusters.forEach(([clusterId, cluster]) => {
      maxStackCount = Math.max(maxStackCount, cluster.stackCount);

      let clusterRow = rowEnds.findIndex((rowEnd) => cluster.x1 - rowEnd > 26);
      if (clusterRow === -1) {
        clusterRow = rowEnds.length;
        rowEnds.push(cluster.x2);
      } else {
        rowEnds[clusterRow] = cluster.x2;
      }

      clusterRowLookup.set(clusterId, clusterRow);
    });

    laneRowCount.set(lane.id, Math.max(1, rowEnds.length));
    laneRowHeight.set(lane.id, 62 + (maxStackCount - 1) * 18);
  });

  let currentTop = GRAPH_TOP;
  const lanes: SemanticLane[] = semanticLaneCatalog.map((lane) => {
    const rowCount = laneRowCount.get(lane.id) ?? 1;
    const rowHeight = laneRowHeight.get(lane.id) ?? 62;
    const height = Math.max(102, 22 + rowCount * rowHeight + 18);
    const laneLayout = {
      id: lane.id,
      label: lane.label,
      top: currentTop,
      center: currentTop + height / 2,
      height,
    };

    currentTop += height + LANE_GAP;
    return laneLayout;
  });

  const laneLookup = new Map(lanes.map((lane) => [lane.id, lane]));

  const nodes: GraphNode[] = rawNodes.map((node) => {
    const lane = laneLookup.get(node.laneId)!;
    const clusterRow = clusterRowLookup.get(node.clusterId) ?? 0;
    const rowHeight = laneRowHeight.get(node.laneId) ?? 62;
    const stackIndex = stackIndexByEventId.get(node.event.id) ?? 0;

    return {
      ...node,
      y: lane.top + 30 + clusterRow * rowHeight + stackIndex * 18,
      stackIndex,
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
          kind: 'sequence',
        });
      }

      event.causalityRefs.forEach((sourceId) => {
        edges.push({
          id: `cause-${sourceId}-${event.id}`,
          sourceId,
          targetId: event.id,
          kind: 'causal',
        });
      });
    });
  }

  const clusterLookup = new Map<string, GraphNode[]>();
  nodes.forEach((node) => {
    const bucket = clusterLookup.get(node.clusterId) ?? [];
    bucket.push(node);
    clusterLookup.set(node.clusterId, bucket);
  });

  const clusters: GraphCluster[] = Array.from(clusterLookup.entries()).map(([clusterId, clusterNodes]) => {
    const flowId = clusterNodes[0].event.flowId;
    const laneId = clusterNodes[0].laneId;
    const metrics = clusterMetrics.get(clusterId)!;
    const minY = Math.min(...clusterNodes.map((node) => node.y)) - 24;
    const maxY = Math.max(...clusterNodes.map((node) => node.y)) + 28;

    return {
      id: clusterId,
      flowId,
      laneId,
      x1: metrics.x1,
      x2: metrics.x2,
      y: minY,
      height: maxY - minY,
      eventCount: metrics.eventCount,
      contradictionCount: metrics.contradictionCount,
    };
  });

  return {
    nodes,
    edges,
    lanes,
    clusters,
    width: GRAPH_WIDTH,
    height: Math.max(420, currentTop + 24),
    bounds,
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
