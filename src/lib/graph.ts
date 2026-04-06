import { EventRecord, GraphEdge, GraphNode, TimeBounds } from '../types';
import { groupEventsByFlow, sortEvents } from './engine';

const GRAPH_WIDTH = 1200;
const LEFT_GUTTER = 140;
const RIGHT_GUTTER = 140;
const MIN_SPAN = 10 * 60 * 1000;

export const getTimeBounds = (events: EventRecord[]): TimeBounds => {
  const ordered = sortEvents(events);
  const timestamps = ordered.map((event) => new Date(event.ts).getTime());
  const min = Math.min(...timestamps);
  const max = Math.max(...timestamps);
  const span = Math.max(max - min, MIN_SPAN);

  return { min, max, span };
};

export const buildGraphLayout = (events: EventRecord[], contradictionCounts: Map<string, number>) => {
  const bounds = getTimeBounds(events);
  const usableWidth = GRAPH_WIDTH - LEFT_GUTTER - RIGHT_GUTTER;
  const grouped = groupEventsByFlow(events);
  const flowIds = [...grouped.keys()];
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  flowIds.forEach((flowId, lane) => {
    const laneEvents = grouped.get(flowId) ?? [];
    laneEvents.forEach((event, index) => {
      const offset = new Date(event.ts).getTime() - bounds.min;
      const x = LEFT_GUTTER + (offset / bounds.span) * usableWidth;
      const y = 84 + lane * 190 + (index % 2 === 0 ? 0 : 36);

      nodes.push({
        event,
        x,
        y,
        lane,
        contradictionCount: contradictionCounts.get(event.id) ?? 0,
      });

      const previous = laneEvents[index - 1];
      if (previous) {
        edges.push({
          id: `seq-${previous.id}-${event.id}`,
          sourceId: previous.id,
          targetId: event.id,
          kind: 'sequence',
        });
      }

      for (const sourceId of event.causalityRefs) {
        edges.push({
          id: `cause-${sourceId}-${event.id}`,
          sourceId,
          targetId: event.id,
          kind: 'causal',
        });
      }
    });
  });

  return {
    nodes,
    edges,
    width: GRAPH_WIDTH,
    height: Math.max(340, flowIds.length * 190 + 120),
    bounds,
    flowIds,
  };
};

export const formatAxisLabel = (timestamp: number) =>
  new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

export const buildTicks = (bounds: TimeBounds, count = 5) => {
  const step = bounds.span / (count - 1);

  return Array.from({ length: count }, (_, index) => {
    const value = bounds.min + step * index;
    const usableWidth = GRAPH_WIDTH - LEFT_GUTTER - RIGHT_GUTTER;
    return {
      value,
      label: formatAxisLabel(value),
      x: LEFT_GUTTER + ((value - bounds.min) / bounds.span) * usableWidth,
    };
  });
};
