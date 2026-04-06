import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { constraintRules, defaultScenarioId, demoScenarios, eventTypes, sampleLedger } from './data/sampleData';
import { detectContradictions, deriveHypotheses, sortEvents } from './lib/engine';
import { buildGraphLayout, buildTicks, buildTimeBands, GRAPH_LEFT_GUTTER } from './lib/graph';
import {
  ContradictionSeverity,
  DemoScenario,
  EventFormState,
  EventRecord,
  EventType,
  GraphEdge,
  GraphNode,
  SemanticLaneId,
} from './types';

const storageKey = 'chronoflow-v0-ledger';
const scenarioStorageKey = 'chronoflow-v0-scenario';
const severityOrder: ContradictionSeverity[] = ['high', 'medium'];

const initialFormState = (): EventFormState => ({
  flowId: 'order-9900',
  ts: new Date().toISOString().slice(0, 16),
  type: 'ORDER_CREATED',
  payload: '{\n  "note": "manually appended"\n}',
  causalityRefs: '',
});

const prettyType = (value: string) =>
  value
    .toLowerCase()
    .split('_')
    .map((segment) => segment[0]?.toUpperCase() + segment.slice(1))
    .join(' ');

const edgeStroke = (edge: GraphEdge) => (edge.kind === 'causal' ? 'var(--line-causal)' : 'var(--line-sequence)');

const compactTypeLabels: Record<EventType, string> = {
  ORDER_CREATED: 'Order',
  INVENTORY_RESERVED: 'Reserve',
  PAYMENT_AUTHORIZED: 'Auth OK',
  PAYMENT_FAILED: 'Pay Fail',
  PACKING_STARTED: 'Packing',
  PACKED: 'Packed',
  SHIPPED: 'Shipped',
  DELIVERY_CONFIRMED: 'Delivered',
  CANCELED: 'Canceled',
  RETURN_INITIATED: 'Return',
};

const laneAccentMap: Record<SemanticLaneId, string> = {
  payment: '#7bd7ec',
  inventory: '#7fe89d',
  shipment: '#ffb66e',
  cancellation: '#ff7a7a',
  reconciliation: '#c5ddb4',
};

const eventIconIds: Record<EventType, string> = {
  ORDER_CREATED: 'icon-order-created',
  INVENTORY_RESERVED: 'icon-inventory-reserved',
  PAYMENT_AUTHORIZED: 'icon-payment-authorized',
  PAYMENT_FAILED: 'icon-payment-failed',
  PACKING_STARTED: 'icon-packing-started',
  PACKED: 'icon-packed',
  SHIPPED: 'icon-shipped',
  DELIVERY_CONFIRMED: 'icon-delivery-confirmed',
  CANCELED: 'icon-canceled',
  RETURN_INITIATED: 'icon-return-initiated',
};

const formatSeverity = (value: ContradictionSeverity) => value[0].toUpperCase() + value.slice(1);

const formatEventTime = (value: string) =>
  new Date(value).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

const safeParsePayload = (value: string) => {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
};

const EventIconDefs = () => (
  <>
    <symbol id="icon-order-created" viewBox="0 0 16 16">
      <rect x="2.25" y="2.25" width="11.5" height="11.5" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 4.5v7M4.5 8h7" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
    </symbol>
    <symbol id="icon-inventory-reserved" viewBox="0 0 16 16">
      <path d="M3.5 5.25 8 3l4.5 2.25L8 7.5Z" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.4" />
      <path d="M3.5 5.25v5.5L8 13l4.5-2.25v-5.5" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.4" />
      <path d="m6.2 8.2 1.15 1.2 2.45-2.6" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.4" />
    </symbol>
    <symbol id="icon-payment-authorized" viewBox="0 0 16 16">
      <rect x="2.25" y="3.25" width="11.5" height="8.5" rx="2.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M3.5 6h9" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="m6.1 10 1.2 1.25 2.55-2.7" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.4" />
    </symbol>
    <symbol id="icon-payment-failed" viewBox="0 0 16 16">
      <rect x="2.25" y="3.25" width="11.5" height="8.5" rx="2.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M3.5 6h9" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="m6 8.35 4 4m0-4-4 4" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4" />
    </symbol>
    <symbol id="icon-packing-started" viewBox="0 0 16 16">
      <path d="M3.4 5.2 8 3l4.6 2.2L8 7.4Z" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.4" />
      <path d="M3.4 5.2v5.7L8 13.1l4.6-2.2V5.2" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.4" />
      <path d="m7 6.4 3.1 1.7L7 9.8Z" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.4" />
    </symbol>
    <symbol id="icon-packed" viewBox="0 0 16 16">
      <path d="M3.3 5.1 8 2.8l4.7 2.3v5.8L8 13.2l-4.7-2.3Z" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.4" />
      <path d="M8 2.8v10.4M3.3 5.1 8 7.5l4.7-2.4" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.4" />
    </symbol>
    <symbol id="icon-shipped" viewBox="0 0 16 16">
      <path d="M2.5 5.5h7v4.2h-7Z" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.4" />
      <path d="M9.5 6.6h2.2l1.8 1.7v1.4H9.5Z" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.4" />
      <circle cx="5.1" cy="11.3" r="1.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="11.6" cy="11.3" r="1.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </symbol>
    <symbol id="icon-delivery-confirmed" viewBox="0 0 16 16">
      <path d="M8 13.2s4-3.5 4-6.4A4 4 0 0 0 4 6.8c0 2.9 4 6.4 4 6.4Z" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.4" />
      <path d="m6.15 6.85 1.2 1.2 2.4-2.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.4" />
    </symbol>
    <symbol id="icon-canceled" viewBox="0 0 16 16">
      <circle cx="8" cy="8" r="5.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="m5.1 10.9 5.8-5.8" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4" />
    </symbol>
    <symbol id="icon-return-initiated" viewBox="0 0 16 16">
      <path d="M11.8 5.3A4.6 4.6 0 0 0 4.5 4.2L3 5.7" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.4" />
      <path d="M5.2 5.7H3V3.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.4" />
      <path d="M4.2 10.7A4.6 4.6 0 0 0 11.5 11.8L13 10.3" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.4" />
      <path d="M10.8 10.3H13v2.2" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.4" />
    </symbol>
  </>
);

function App() {
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>(() => {
    const saved = window.localStorage.getItem(scenarioStorageKey);
    return demoScenarios.some((scenario) => scenario.id === saved) ? saved ?? defaultScenarioId : defaultScenarioId;
  });
  const [ledger, setLedger] = useState<EventRecord[]>(() => {
    const saved = window.localStorage.getItem(storageKey);

    if (!saved) {
      return sampleLedger;
    }

    try {
      const parsed = JSON.parse(saved) as EventRecord[];
      return parsed.length > 0 ? parsed : sampleLedger;
    } catch {
      return sampleLedger;
    }
  });
  const [formState, setFormState] = useState<EventFormState>(initialFormState);
  const [selectedContradictionId, setSelectedContradictionId] = useState<string | null | undefined>(undefined);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [openSeverities, setOpenSeverities] = useState<ContradictionSeverity[]>(['high']);
  const [focusedFlowId, setFocusedFlowId] = useState<string | null>(null);
  const [hoveredEventId, setHoveredEventId] = useState<string | null>(null);
  const graphSurfaceRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    window.localStorage.setItem(storageKey, JSON.stringify(ledger));
  }, [ledger]);

  useEffect(() => {
    window.localStorage.setItem(scenarioStorageKey, selectedScenarioId);
  }, [selectedScenarioId]);

  const orderedLedger = useMemo(() => sortEvents(ledger), [ledger]);
  const eventLookup = useMemo(() => new Map(orderedLedger.map((event) => [event.id, event])), [orderedLedger]);
  const hypotheses = useMemo(() => deriveHypotheses(orderedLedger), [orderedLedger]);
  const contradictions = useMemo(() => detectContradictions(orderedLedger, constraintRules), [orderedLedger]);

  useEffect(() => {
    if (contradictions.length === 0) {
      setSelectedContradictionId(null);
      return;
    }

    if (selectedContradictionId === undefined) {
      setSelectedContradictionId(contradictions[0].id);
      return;
    }

    if (selectedContradictionId !== null && !contradictions.some((item) => item.id === selectedContradictionId)) {
      setSelectedContradictionId(contradictions[0].id);
    }
  }, [contradictions, selectedContradictionId]);

  const selectedContradiction = useMemo(
    () =>
      selectedContradictionId === null
        ? null
        : contradictions.find((item) => item.id === selectedContradictionId) ?? contradictions[0] ?? null,
    [contradictions, selectedContradictionId],
  );

  useEffect(() => {
    const availableSeverities = severityOrder.filter((severity) =>
      contradictions.some((item) => item.severity === severity),
    );

    setOpenSeverities((current) => {
      const filtered = current.filter((severity) => availableSeverities.includes(severity));
      const seeded = filtered.length > 0 ? filtered : availableSeverities.slice(0, 1);

      if (selectedContradiction && !seeded.includes(selectedContradiction.severity)) {
        return [...seeded, selectedContradiction.severity];
      }

      return seeded;
    });
  }, [contradictions, selectedContradiction]);

  const contradictionCounts = useMemo(() => {
    const counts = new Map<string, number>();

    contradictions.forEach((item) => {
      item.relatedEventIds.forEach((eventId) => {
        counts.set(eventId, (counts.get(eventId) ?? 0) + 1);
      });
    });

    return counts;
  }, [contradictions]);

  const contradictionSeverities = useMemo(() => {
    const severities = new Map<string, ContradictionSeverity>();

    contradictions.forEach((item) => {
      item.relatedEventIds.forEach((eventId) => {
        const current = severities.get(eventId);
        if (current === 'high') {
          return;
        }

        severities.set(eventId, item.severity === 'high' || current === undefined ? item.severity : current);
      });
    });

    return severities;
  }, [contradictions]);

  const selectedEvent = useMemo(
    () => (selectedEventId ? eventLookup.get(selectedEventId) ?? null : null),
    [eventLookup, selectedEventId],
  );

  const graph = useMemo(
    () => buildGraphLayout(ledger, contradictionCounts, contradictionSeverities),
    [ledger, contradictionCounts, contradictionSeverities],
  );
  const ticks = useMemo(() => buildTicks(graph.bounds), [graph.bounds]);
  const timeBands = useMemo(() => buildTimeBands(graph.bounds), [graph.bounds]);
  const nodeLookup = useMemo(() => new Map(graph.nodes.map((node) => [node.event.id, node])), [graph.nodes]);

  const laneEventCounts = useMemo(() => {
    const counts = new Map<string, number>();
    graph.nodes.forEach((node) => {
      counts.set(node.laneId, (counts.get(node.laneId) ?? 0) + 1);
    });
    return counts;
  }, [graph.nodes]);

  const contradictionsBySeverity = useMemo(
    () => ({
      high: contradictions.filter((item) => item.severity === 'high'),
      medium: contradictions.filter((item) => item.severity === 'medium'),
    }),
    [contradictions],
  );

  const hypothesisTracks = useMemo(() => {
    const grouped = new Map<string, typeof hypotheses>();

    hypotheses.forEach((hypothesis) => {
      const bucket = grouped.get(hypothesis.flowId) ?? [];
      bucket.push(hypothesis);
      grouped.set(hypothesis.flowId, bucket);
    });

    return Array.from(grouped.entries())
      .map(([flowId, items]) => ({
        flowId,
        items: [...items].sort(
          (left, right) => new Date(left.validFrom).getTime() - new Date(right.validFrom).getTime(),
        ),
      }))
      .sort((left, right) => left.flowId.localeCompare(right.flowId));
  }, [hypotheses]);

  const selectedScenario = useMemo(
    () => demoScenarios.find((scenario) => scenario.id === selectedScenarioId) ?? demoScenarios[0],
    [selectedScenarioId],
  );

  const flowFocusOptions = useMemo(() => {
    const byFlow = new Map<
      string,
      {
        flowId: string;
        eventCount: number;
        contradictionCount: number;
      }
    >();

    orderedLedger.forEach((event) => {
      const bucket = byFlow.get(event.flowId) ?? {
        flowId: event.flowId,
        eventCount: 0,
        contradictionCount: 0,
      };
      bucket.eventCount += 1;
      bucket.contradictionCount += contradictionCounts.get(event.id) ?? 0;
      byFlow.set(event.flowId, bucket);
    });

    return Array.from(byFlow.values()).sort((left, right) => {
      if (right.contradictionCount !== left.contradictionCount) {
        return right.contradictionCount - left.contradictionCount;
      }
      return left.flowId.localeCompare(right.flowId);
    });
  }, [orderedLedger, contradictionCounts]);

  const activeEventIds = useMemo(() => {
    if (selectedContradiction) {
      return new Set(selectedContradiction.relatedEventIds);
    }

    if (selectedEventId) {
      return new Set([selectedEventId]);
    }

    return new Set<string>();
  }, [selectedContradiction, selectedEventId]);

  const highlightedFlowId = selectedContradiction?.flowId ?? selectedEvent?.flowId ?? focusedFlowId ?? null;
  const lineageFlowId =
    selectedContradiction?.flowId ??
    selectedEvent?.flowId ??
    (hoveredEventId ? eventLookup.get(hoveredEventId)?.flowId : null) ??
    focusedFlowId ??
    null;

  const selectedTimelineRegion = useMemo(() => {
    const targetEventIds = selectedContradiction
      ? selectedContradiction.relatedEventIds
      : selectedEventId
        ? [selectedEventId]
        : highlightedFlowId
          ? orderedLedger.filter((event) => event.flowId === highlightedFlowId).map((event) => event.id)
          : [];

    const targetNodes = targetEventIds
      .map((eventId) => nodeLookup.get(eventId))
      .filter((node): node is GraphNode => Boolean(node));

    if (targetNodes.length === 0) {
      return null;
    }

    const x1 = Math.max(GRAPH_LEFT_GUTTER - 18, Math.min(...targetNodes.map((node) => node.x)) - 28);
    const x2 = Math.min(graph.width - 30, Math.max(...targetNodes.map((node) => node.x + node.width)) + 32);

    return {
      x1,
      x2,
      width: x2 - x1,
      center: (x1 + x2) / 2,
    };
  }, [graph.width, highlightedFlowId, nodeLookup, orderedLedger, selectedContradiction, selectedEventId]);

  const visibleLineageEdges = useMemo(() => {
    if (!lineageFlowId) {
      return [];
    }

    return graph.edges.filter((edge) => {
      const source = eventLookup.get(edge.sourceId);
      const target = eventLookup.get(edge.targetId);
      return source?.flowId === lineageFlowId && target?.flowId === lineageFlowId;
    });
  }, [eventLookup, graph.edges, lineageFlowId]);

  useEffect(() => {
    if (!selectedContradiction || !selectedTimelineRegion || !graphSurfaceRef.current) {
      return;
    }

    const nextLeft = Math.max(0, selectedTimelineRegion.center - graphSurfaceRef.current.clientWidth / 2);
    graphSurfaceRef.current.scrollTo({
      left: nextLeft,
      behavior: 'smooth',
    });
  }, [selectedContradiction, selectedTimelineRegion]);

  const appendEvent = (event: EventRecord) => {
    setLedger((current) => [...current, event]);
    setSelectedEventId(event.id);
    setSelectedContradictionId(null);
    setFocusedFlowId(event.flowId);
    setHoveredEventId(null);
  };

  const focusFlow = (flowId: string | null) => {
    setSelectedEventId(null);
    setSelectedContradictionId(null);
    setFocusedFlowId(flowId);
    setHoveredEventId(null);
  };

  const toggleFlowFocus = (flowId: string) => {
    setSelectedEventId(null);
    setSelectedContradictionId(null);
    setFocusedFlowId((current) => (current === flowId ? null : flowId));
    setHoveredEventId(null);
  };

  const handleSubmit = (submitEvent: FormEvent<HTMLFormElement>) => {
    submitEvent.preventDefault();
    const parsedPayload = safeParsePayload(formState.payload);

    if (!parsedPayload) {
      setFormError('Payload must be valid JSON.');
      return;
    }

    const normalizedTs = new Date(formState.ts).toISOString();
    const event: EventRecord = {
      id: `evt-${crypto.randomUUID().slice(0, 8)}`,
      flowId: formState.flowId.trim(),
      ts: normalizedTs,
      type: formState.type,
      payload: parsedPayload,
      causalityRefs: formState.causalityRefs
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    };

    appendEvent(event);
    setFormError(null);
    setFormState((current) => ({
      ...current,
      ts: new Date(Date.now() + 60_000).toISOString().slice(0, 16),
      payload: '{\n  "note": "manually appended"\n}',
      causalityRefs: event.id,
    }));
  };

  const loadScenario = (scenario: DemoScenario) => {
    setLedger(scenario.events);
    setSelectedScenarioId(scenario.id);
    setSelectedEventId(null);
    setSelectedContradictionId(undefined);
    setOpenSeverities(['high']);
    setFocusedFlowId(null);
    setHoveredEventId(null);
  };

  const resetToSample = () => {
    loadScenario(demoScenarios[0]);
  };

  const toggleSeverity = (severity: ContradictionSeverity) => {
    setOpenSeverities((current) =>
      current.includes(severity) ? current.filter((item) => item !== severity) : [...current, severity],
    );
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">ChronoFlow v0</p>
          <h1>Temporal reasoning for contradiction-heavy distributed workflows.</h1>
        </div>
        <div className="metrics">
          <div className="metric-card">
            <span>Ledger events</span>
            <strong>{orderedLedger.length}</strong>
          </div>
          <div className="metric-card danger">
            <span>Active contradictions</span>
            <strong>{contradictions.length}</strong>
          </div>
          <div className="metric-card">
            <span>Hypotheses</span>
            <strong>{hypotheses.length}</strong>
          </div>
        </div>
      </header>

      <main className="workspace">
        <section className="panel left-panel">
          <div className="panel-heading">
            <div>
              <p className="section-label">Event ingest</p>
              <h2>Append-only ledger</h2>
            </div>
            <button className="ghost-button" onClick={resetToSample} type="button">
              Reset seed
            </button>
          </div>

          <div className="scenario-panel">
            <div className="panel-heading compact">
              <div>
                <p className="section-label">Demo lineages</p>
                <h3>{selectedScenario.name}</h3>
              </div>
            </div>
            <p className="scenario-description">{selectedScenario.description}</p>
            <div className="scenario-button-grid">
              {demoScenarios.map((scenario) => (
                <button
                  key={scenario.id}
                  type="button"
                  className={`scenario-button ${selectedScenarioId === scenario.id ? 'active' : ''}`}
                  onClick={() => loadScenario(scenario)}
                >
                  <strong>{scenario.name}</strong>
                  <span>
                    {scenario.events.length} events · {new Set(scenario.events.map((event) => event.flowId)).size} flows
                  </span>
                </button>
              ))}
            </div>
          </div>

          <form className="ingest-form" onSubmit={handleSubmit}>
            <label>
              Flow ID
              <input
                value={formState.flowId}
                onChange={(event) => setFormState((current) => ({ ...current, flowId: event.target.value }))}
                placeholder="order-9900"
              />
            </label>
            <div className="inline-fields">
              <label>
                Timestamp
                <input
                  type="datetime-local"
                  value={formState.ts}
                  onChange={(event) => setFormState((current) => ({ ...current, ts: event.target.value }))}
                />
              </label>
              <label>
                Type
                <select
                  value={formState.type}
                  onChange={(event) =>
                    setFormState((current) => ({
                      ...current,
                      type: event.target.value as EventFormState['type'],
                    }))
                  }
                >
                  {eventTypes.map((eventType) => (
                    <option key={eventType} value={eventType}>
                      {prettyType(eventType)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              Payload JSON
              <textarea
                value={formState.payload}
                onChange={(event) => setFormState((current) => ({ ...current, payload: event.target.value }))}
                rows={6}
              />
            </label>
            <label>
              Causality refs
              <input
                value={formState.causalityRefs}
                onChange={(event) => setFormState((current) => ({ ...current, causalityRefs: event.target.value }))}
                placeholder="evt-100, evt-101"
              />
            </label>
            {formError ? <p className="form-error">{formError}</p> : null}
            <button className="primary-button" type="submit">
              Append event
            </button>
          </form>

          <div className="ledger-meta">
            <p className="section-label">Constraint rules</p>
            <ul className="rule-list">
              {constraintRules.map((rule) => (
                <li key={rule.name}>
                  <strong>{rule.name}</strong>
                  <span>
                    When {prettyType(rule.when)} occurs, it requires {rule.requires?.length ?? 0} and forbids{' '}
                    {rule.forbids?.length ?? 0} conditions.
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="ledger-list">
            <div className="panel-heading compact">
              <div>
                <p className="section-label">Ledger</p>
                <h3>Raw event stream</h3>
              </div>
            </div>
            {orderedLedger.map((event) => {
              const contradictionCount = contradictionCounts.get(event.id) ?? 0;
              return (
                <button
                  key={event.id}
                  className={`ledger-item ${selectedEventId === event.id ? 'selected' : ''} ${
                    contradictionCount > 0 ? 'flagged' : ''
                  }`}
                  onClick={() => {
                    setSelectedEventId(event.id);
                    setSelectedContradictionId(null);
                    setFocusedFlowId(event.flowId);
                    setHoveredEventId(null);
                  }}
                  type="button"
                >
                  <div>
                    <strong>{prettyType(event.type)}</strong>
                    <span>
                      {event.flowId} · {formatEventTime(event.ts)}
                    </span>
                  </div>
                  <div className="ledger-badges">
                    {contradictionCount > 0 ? <span className="chip danger">{contradictionCount} conflict</span> : null}
                    <span className="chip">{event.id}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <section className="center-column">
          <section className="panel graph-panel">
            <div className="panel-heading">
              <div>
                <p className="section-label">Temporal trace</p>
                <h2>Workflow timeline</h2>
              </div>
              <div className="graph-insights">
                {graph.lanes.map((lane) => (
                  <span className="mini-stat" key={lane.id}>
                    {lane.label} {laneEventCounts.get(lane.id) ?? 0}
                  </span>
                ))}
              </div>
            </div>

            <div className="lineage-toolbar">
              <div className="lineage-toolbar-header">
                <p className="section-label">Lineage focus</p>
                <button
                  className={`lineage-chip ghost ${highlightedFlowId === null ? 'active' : ''}`}
                  onClick={() => focusFlow(null)}
                  type="button"
                >
                  Show all
                </button>
              </div>
              <div className="lineage-chip-row">
                {flowFocusOptions.map((flow) => (
                  <button
                    key={flow.flowId}
                    type="button"
                    className={`lineage-chip ${highlightedFlowId === flow.flowId ? 'active' : ''} ${
                      flow.contradictionCount > 0 ? 'flagged' : ''
                    }`}
                    onClick={() => toggleFlowFocus(flow.flowId)}
                  >
                    <strong>{flow.flowId}</strong>
                    <span>
                      {flow.eventCount} events · {flow.contradictionCount} hits
                    </span>
                  </button>
                ))}
              </div>
              <p className="lineage-status">
                {highlightedFlowId
                  ? `Focused lineage: ${highlightedFlowId}. Hover or select pills to reveal the causal trace.`
                  : 'Tip: hover a pill or select a contradiction to reveal one lineage at a time.'}
              </p>
            </div>

            <div className="graph-surface" ref={graphSurfaceRef}>
              <svg viewBox={`0 0 ${graph.width} ${graph.height}`} role="img" aria-label="Stable swimlane timeline of order events">
                <defs>
                  <marker id="lineage-arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
                    <path d="M0,0 L8,4 L0,8 Z" fill="var(--line-causal)" />
                  </marker>
                  <EventIconDefs />
                </defs>

                {selectedTimelineRegion ? (
                  <rect
                    className="timeline-focus-window"
                    x={selectedTimelineRegion.x1}
                    y={12}
                    width={selectedTimelineRegion.width}
                    height={graph.height - 24}
                    rx={20}
                  />
                ) : null}

                <rect
                  className="sparkline-shell"
                  x={GRAPH_LEFT_GUTTER - 18}
                  y={graph.sparklineTop - 2}
                  width={graph.width - GRAPH_LEFT_GUTTER - 28}
                  height={graph.sparklineHeight + 12}
                  rx={16}
                />
                <text className="sparkline-label" x={28} y={graph.sparklineTop + 18}>
                  Conflict density
                </text>
                <path className="sparkline-area" d={graph.sparkline.areaPath} />
                <path className="sparkline-line" d={graph.sparkline.linePath} />

                {timeBands.map((band) => (
                  <rect
                    key={band.index}
                    className={`time-band ${band.index % 2 === 0 ? 'even' : 'odd'}`}
                    x={band.x}
                    y={graph.timelineTop - 10}
                    width={band.width}
                    height={graph.timelineBottom - graph.timelineTop + 10}
                  />
                ))}

                {graph.heatBands.map((band) => (
                  <rect
                    key={band.index}
                    className={`conflict-heat ${band.intensity > 0.58 ? 'high' : 'medium'}`}
                    x={band.x}
                    y={graph.timelineTop - 10}
                    width={band.width}
                    height={graph.timelineBottom - graph.timelineTop + 10}
                    opacity={0.08 + band.intensity * 0.24}
                  />
                ))}

                {graph.lanes.map((lane) => (
                  <g key={lane.id}>
                    <rect
                      className="swimlane-band"
                      x={GRAPH_LEFT_GUTTER - 52}
                      y={lane.top}
                      width={graph.width - GRAPH_LEFT_GUTTER - 36}
                      height={lane.height}
                      rx={24}
                    />
                    <text className="swimlane-label" x={26} y={lane.center - 5}>
                      {lane.label}
                    </text>
                    <text className="swimlane-count" x={26} y={lane.center + 13}>
                      {laneEventCounts.get(lane.id) ?? 0} events
                    </text>
                    <line
                      className="lane-line"
                      x1={GRAPH_LEFT_GUTTER - 16}
                      y1={lane.top}
                      x2={graph.width - 32}
                      y2={lane.top}
                    />
                    <line
                      className="lane-line"
                      x1={GRAPH_LEFT_GUTTER - 16}
                      y1={lane.top + lane.height}
                      x2={graph.width - 32}
                      y2={lane.top + lane.height}
                    />
                    {lane.slots.map((slot) => {
                      const slotLabelWidth = Math.max(74, slot.flowId.length * 7 + 18);
                      const slotActive = Boolean(slot.flowId) && highlightedFlowId === slot.flowId;

                      return (
                        <g key={`${lane.id}-${slot.flowId || 'empty'}-${slot.index}`}>
                          {slot.flowId ? (
                            <>
                              <rect
                                className={`slot-label-shell ${slotActive ? 'active' : ''}`}
                                x={116}
                                y={slot.center - 11}
                                width={slotLabelWidth}
                                height={22}
                                rx={11}
                              />
                              <text className={`slot-flow-label ${slotActive ? 'active' : ''}`} x={126} y={slot.center + 4}>
                                {slot.flowId}
                              </text>
                            </>
                          ) : null}
                          <line
                            className="slot-divider"
                            x1={GRAPH_LEFT_GUTTER - 16}
                            y1={slot.top + slot.height}
                            x2={graph.width - 32}
                            y2={slot.top + slot.height}
                          />
                        </g>
                      );
                    })}
                  </g>
                ))}

                {ticks.map((tick) => (
                  <g key={tick.value}>
                    <line className="tick-line" x1={tick.x} y1={graph.timelineTop - 12} x2={tick.x} y2={graph.height - 22} />
                    <text className="tick-label" x={tick.x} y={graph.timelineTop - 22}>
                      {tick.label}
                    </text>
                  </g>
                ))}

                {visibleLineageEdges.map((edge) => {
                  const source = nodeLookup.get(edge.sourceId);
                  const target = nodeLookup.get(edge.targetId);
                  if (!source || !target) {
                    return null;
                  }

                  const startX = source.x + source.width;
                  const endX = target.x;
                  const startY = source.y;
                  const endY = target.y;
                  const elbowX = startX + Math.max(18, (endX - startX) * 0.42);
                  const path =
                    edge.kind === 'sequence' && Math.abs(startY - endY) < 1
                      ? `M ${startX} ${startY} L ${endX} ${endY}`
                      : `M ${startX} ${startY} L ${elbowX} ${startY} L ${elbowX} ${endY} L ${endX} ${endY}`;

                  return (
                    <path
                      key={edge.id}
                      className={`lineage-link ${edge.kind}`}
                      d={path}
                      stroke={edgeStroke(edge)}
                      markerEnd={edge.kind === 'causal' ? 'url(#lineage-arrow)' : undefined}
                    />
                  );
                })}

                {graph.nodes.map((node) => {
                  const isRelated = activeEventIds.has(node.event.id);
                  const isSelected = selectedEventId === node.event.id;
                  const isHovered = hoveredEventId === node.event.id;
                  const isDimmed =
                    Boolean(highlightedFlowId && highlightedFlowId !== node.event.flowId) &&
                    !isRelated &&
                    !isSelected &&
                    !isHovered;

                  return (
                    <g
                      key={node.event.id}
                      className={`timeline-event ${node.severity} ${isRelated || isSelected ? 'active' : ''} ${
                        isHovered ? 'hovered' : ''
                      }`}
                      opacity={isDimmed ? 0.2 : 1}
                      onClick={() => {
                        setSelectedEventId(node.event.id);
                        setFocusedFlowId(node.event.flowId);
                        const hit = contradictions.find((item) => item.relatedEventIds.includes(node.event.id));
                        setSelectedContradictionId(hit?.id ?? null);
                        setHoveredEventId(node.event.id);
                      }}
                      onMouseEnter={() => setHoveredEventId(node.event.id)}
                      onMouseLeave={() => setHoveredEventId((current) => (current === node.event.id ? null : current))}
                    >
                      <rect
                        className="timeline-event-hitbox"
                        x={node.x - 4}
                        y={node.y - node.height / 2 - 4}
                        rx={12}
                        ry={12}
                        width={node.width + 8}
                        height={node.height + 8}
                      />
                      <rect
                        className="timeline-event-shell"
                        x={node.x}
                        y={node.y - node.height / 2}
                        rx={11}
                        ry={11}
                        width={node.width}
                        height={node.height}
                      />
                      <rect
                        className="timeline-event-accent"
                        x={node.x}
                        y={node.y - node.height / 2}
                        width={5}
                        height={node.height}
                        rx={11}
                        fill={laneAccentMap[node.laneId]}
                      />
                      <use
                        href={`#${eventIconIds[node.event.type]}`}
                        x={node.x + 10}
                        y={node.y - 8}
                        width={16}
                        height={16}
                        className="timeline-event-icon"
                        style={{ color: laneAccentMap[node.laneId] }}
                      />
                      <text x={node.x + 32} y={node.y + 4} className="timeline-event-label">
                        {compactTypeLabels[node.event.type]}
                      </text>
                      {node.contradictionCount > 0 ? (
                        <>
                          <circle
                            className={`timeline-event-badge ${node.severity}`}
                            cx={node.x + node.width - 14}
                            cy={node.y}
                            r={8.5}
                          />
                          <text x={node.x + node.width - 14} y={node.y + 3.4} className="timeline-event-badge-label">
                            {node.contradictionCount}
                          </text>
                        </>
                      ) : null}
                    </g>
                  );
                })}
              </svg>
            </div>
          </section>

          <section className="panel hypothesis-panel">
            <div className="panel-heading compact">
              <div>
                <p className="section-label">State evolution</p>
                <h2>Hypothesis strip</h2>
              </div>
              <p className="graph-caption">Chronological state assumptions compacted by flow for quick comparison.</p>
            </div>

            <div className="state-strip">
              {hypothesisTracks.map((track) => (
                <article key={track.flowId} className={`state-row ${highlightedFlowId === track.flowId ? 'active' : ''}`}>
                  <div className="state-row-meta">
                    <strong>{track.flowId}</strong>
                    <span>{track.items.length} states</span>
                  </div>
                  <div className="state-track">
                    {track.items.map((hypothesis) => (
                      <button
                        className={`state-pill ${hypothesis.kind}`}
                        key={hypothesis.id}
                        type="button"
                        onClick={() => {
                          setSelectedEventId(hypothesis.sourceEventId);
                          setFocusedFlowId(hypothesis.flowId);
                          setSelectedContradictionId(null);
                          setHoveredEventId(null);
                        }}
                      >
                        <span className="state-time">{formatEventTime(hypothesis.validFrom)}</span>
                        <strong>{hypothesis.proposition}</strong>
                        <small>{(hypothesis.confidence * 100).toFixed(0)}% confidence</small>
                      </button>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </section>
        </section>

        <aside className="panel right-panel">
          <div className="panel-heading">
            <div>
              <p className="section-label">Contradictions</p>
              <h2>Detection + reconciliation</h2>
            </div>
          </div>

          <div className="accordion-stack">
            {severityOrder.map((severity) => {
              const items = contradictionsBySeverity[severity];
              if (items.length === 0) {
                return null;
              }

              const isOpen = openSeverities.includes(severity);

              return (
                <section className={`severity-accordion ${severity} ${isOpen ? 'open' : ''}`} key={severity}>
                  <button className="accordion-trigger" type="button" onClick={() => toggleSeverity(severity)}>
                    <div className="accordion-meta">
                      <span className={`severity-pill ${severity}`}>{formatSeverity(severity)}</span>
                      <strong>
                        {items.length} contradiction{items.length === 1 ? '' : 's'}
                      </strong>
                    </div>
                    <span className="accordion-caret" aria-hidden="true">
                      {isOpen ? '−' : '+'}
                    </span>
                  </button>

                  {isOpen ? (
                    <div className="accordion-body">
                      {items.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          className={`contradiction-card ${selectedContradiction?.id === item.id ? 'selected' : ''} ${
                            item.severity
                          }`}
                        onClick={() => {
                          setSelectedContradictionId(item.id);
                          setSelectedEventId(null);
                          setFocusedFlowId(item.flowId);
                          setHoveredEventId(null);
                        }}
                        >
                          <div className="contradiction-header">
                            <span>{item.flowId}</span>
                            <span className="chip">{item.relatedEventIds.length} events</span>
                          </div>
                          <strong>{item.title}</strong>
                          <p>{item.summary}</p>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </section>
              );
            })}
          </div>

          {selectedContradiction ? (
            <div className="detail-stack">
              <section className="detail-card emphasis">
                <p className="section-label">Selected contradiction</p>
                <h3>{selectedContradiction.title}</h3>
                <p className="detail-summary">{selectedContradiction.summary}</p>
                <div className="detail-pills">
                  <span className={`severity-pill ${selectedContradiction.severity}`}>
                    {formatSeverity(selectedContradiction.severity)}
                  </span>
                  <span className="chip">{selectedContradiction.flowId}</span>
                </div>
              </section>

              <section className="detail-card">
                <p className="section-label">Why it broke</p>
                <h3>{selectedContradiction.brokenRule}</h3>
                <ul className="detail-list">
                  {selectedContradiction.evidence.map((entry) => (
                    <li key={entry}>{entry}</li>
                  ))}
                </ul>
              </section>

              <section className="detail-card">
                <p className="section-label">Related events</p>
                <div className="related-events">
                  {selectedContradiction.relatedEventIds.map((eventId) => {
                    const event = eventLookup.get(eventId);
                    if (!event) {
                      return null;
                    }

                    return (
                      <button
                        key={eventId}
                        className="related-event"
                        type="button"
                        onClick={() => {
                          setSelectedEventId(eventId);
                          setFocusedFlowId(event.flowId);
                          setHoveredEventId(null);
                        }}
                      >
                        <strong>{prettyType(event.type)}</strong>
                        <span>
                          {event.flowId} · {formatEventTime(event.ts)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>

              <section className="detail-card">
                <p className="section-label">Reconciliation suggestions</p>
                <div className="suggestion-list">
                  {selectedContradiction.suggestions.map((suggestion) => (
                    <article key={suggestion.id} className="suggestion-card">
                      <strong>{suggestion.title}</strong>
                      <p>{suggestion.detail}</p>
                    </article>
                  ))}
                </div>
              </section>
            </div>
          ) : selectedEvent ? (
            <div className="detail-stack">
              <section className="detail-card">
                <p className="section-label">Event detail</p>
                <h3>{prettyType(selectedEvent.type)}</h3>
                <ul className="detail-list">
                  <li>{selectedEvent.flowId}</li>
                  <li>{formatEventTime(selectedEvent.ts)}</li>
                  <li>{selectedEvent.id}</li>
                  <li>
                    Causality refs: {selectedEvent.causalityRefs.length > 0 ? selectedEvent.causalityRefs.join(', ') : 'none'}
                  </li>
                </ul>
              </section>

              <section className="detail-card">
                <p className="section-label">Payload</p>
                <pre className="payload-block">{JSON.stringify(selectedEvent.payload, null, 2)}</pre>
              </section>

              <section className="detail-card">
                <p className="section-label">Derived hypotheses</p>
                <div className="suggestion-list">
                  {hypotheses
                    .filter((item) => item.sourceEventId === selectedEvent.id)
                    .map((hypothesis) => (
                      <article className="suggestion-card" key={hypothesis.id}>
                        <strong>{hypothesis.proposition}</strong>
                        <p>Confidence {(hypothesis.confidence * 100).toFixed(0)}%</p>
                      </article>
                    ))}
                </div>
              </section>
            </div>
          ) : (
            <div className="empty-state">
              <strong>No contradiction selected.</strong>
              <p>Expand a severity bucket or click any event cluster to inspect the workflow state.</p>
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}

export default App;
