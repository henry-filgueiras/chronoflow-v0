import { FormEvent, useEffect, useMemo, useState } from 'react';
import { constraintRules, defaultScenarioId, demoScenarios, eventTypes, sampleLedger } from './data/sampleData';
import { detectContradictions, deriveHypotheses, sortEvents } from './lib/engine';
import { buildGraphLayout, buildTicks, buildTimeBands, GRAPH_LEFT_GUTTER } from './lib/graph';
import { ContradictionSeverity, DemoScenario, EventFormState, EventRecord, GraphEdge } from './types';

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

  const selectedEvent = useMemo(
    () => (selectedEventId ? eventLookup.get(selectedEventId) ?? null : null),
    [eventLookup, selectedEventId],
  );

  const graph = useMemo(() => buildGraphLayout(orderedLedger, contradictionCounts), [orderedLedger, contradictionCounts]);
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

  const appendEvent = (event: EventRecord) => {
    setLedger((current) => [...current, event]);
    setSelectedEventId(event.id);
    setSelectedContradictionId(null);
    setFocusedFlowId(event.flowId);
  };

  const focusFlow = (flowId: string | null) => {
    setSelectedEventId(null);
    setSelectedContradictionId(null);
    setFocusedFlowId(flowId);
  };

  const toggleFlowFocus = (flowId: string) => {
    setSelectedEventId(null);
    setSelectedContradictionId(null);
    setFocusedFlowId((current) => (current === flowId ? null : flowId));
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
                <p className="section-label">Temporal graph</p>
                <h2>Causal timeline</h2>
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
                  ? `Focused lineage: ${highlightedFlowId}.`
                  : 'Tip: use a lineage chip, contradiction card, or cluster shell to isolate one flow.'}
              </p>
            </div>

            <div className="graph-surface">
              <svg viewBox={`0 0 ${graph.width} ${graph.height}`} role="img" aria-label="Temporal graph of order events">
                <defs>
                  <marker id="arrowhead" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
                    <path d="M0,0 L8,4 L0,8 Z" fill="var(--line-causal)" />
                  </marker>
                </defs>

                {timeBands.map((band) => (
                  <rect
                    key={band.index}
                    className={`time-band ${band.index % 2 === 0 ? 'even' : 'odd'}`}
                    x={band.x}
                    y={42}
                    width={band.width}
                    height={graph.height - 64}
                  />
                ))}

                {graph.lanes.map((lane) => (
                  <g key={lane.id}>
                    <rect
                      className="swimlane-band"
                      x={GRAPH_LEFT_GUTTER - 44}
                      y={lane.top}
                      width={graph.width - 208}
                      height={lane.height}
                      rx={24}
                    />
                    <text className="swimlane-label" x={28} y={lane.center - 4}>
                      {lane.label}
                    </text>
                    <text className="swimlane-count" x={28} y={lane.center + 14}>
                      {laneEventCounts.get(lane.id) ?? 0} events
                    </text>
                    <line
                      className="lane-line"
                      x1={GRAPH_LEFT_GUTTER - 16}
                      y1={lane.top}
                      x2={graph.width - 46}
                      y2={lane.top}
                    />
                    <line
                      className="lane-line"
                      x1={GRAPH_LEFT_GUTTER - 16}
                      y1={lane.top + lane.height}
                      x2={graph.width - 46}
                      y2={lane.top + lane.height}
                    />
                  </g>
                ))}

                {ticks.map((tick) => (
                  <g key={tick.value}>
                    <line className="tick-line" x1={tick.x} y1={42} x2={tick.x} y2={graph.height - 22} />
                    <text className="tick-label" x={tick.x} y={24}>
                      {tick.label}
                    </text>
                  </g>
                ))}

                {graph.clusters.map((cluster) => {
                  const isDimmed = highlightedFlowId ? highlightedFlowId !== cluster.flowId : false;

                  return (
                    <g
                      key={cluster.id}
                      className={`cluster-group ${highlightedFlowId === cluster.flowId ? 'active' : ''}`}
                      opacity={isDimmed ? 0.18 : 0.92}
                      onClick={() => toggleFlowFocus(cluster.flowId)}
                    >
                      <rect
                        className="cluster-hitbox"
                        x={cluster.x1 - 10}
                        y={cluster.y - 10}
                        width={cluster.x2 - cluster.x1 + 20}
                        height={cluster.height + 20}
                        rx={22}
                      />
                      <rect
                        className="cluster-shell"
                        x={cluster.x1}
                        y={cluster.y}
                        width={cluster.x2 - cluster.x1}
                        height={cluster.height}
                        rx={18}
                      />
                      <text className="cluster-label" x={cluster.x1 + 14} y={cluster.y + 18}>
                        {cluster.flowId}
                      </text>
                      <text className="cluster-meta" x={cluster.x1 + 14} y={cluster.y + 34}>
                        {cluster.eventCount} events · {cluster.contradictionCount} hits
                      </text>
                    </g>
                  );
                })}

                {graph.edges.map((edge) => {
                  const source = nodeLookup.get(edge.sourceId);
                  const target = nodeLookup.get(edge.targetId);
                  if (!source || !target) {
                    return null;
                  }

                  const isActive =
                    activeEventIds.size === 0 || (activeEventIds.has(source.event.id) && activeEventIds.has(target.event.id));
                  const midX = (source.x + target.x) / 2;
                  const bend = edge.kind === 'causal' ? Math.max(58, Math.abs(target.y - source.y) * 0.7) : 30;

                  return (
                    <path
                      key={edge.id}
                      className={`graph-edge ${edge.kind}`}
                      d={`M ${source.x} ${source.y + 16} C ${midX} ${source.y + bend}, ${midX} ${target.y - bend}, ${target.x} ${
                        target.y - 12
                      }`}
                      stroke={edgeStroke(edge)}
                      markerEnd={edge.kind === 'causal' ? 'url(#arrowhead)' : undefined}
                      opacity={isActive ? 0.95 : 0.18}
                    />
                  );
                })}

                {graph.nodes.map((node) => {
                  const isRelated = activeEventIds.has(node.event.id);
                  const isDimmed =
                    (highlightedFlowId && highlightedFlowId !== node.event.flowId) ||
                    (activeEventIds.size > 0 && !activeEventIds.has(node.event.id));

                  return (
                    <g
                      key={node.event.id}
                      className={`graph-node ${isRelated ? 'active' : ''} ${node.contradictionCount > 0 ? 'flagged' : ''}`}
                      opacity={isDimmed ? 0.18 : 1}
                      onClick={() => {
                        setSelectedEventId(node.event.id);
                        setFocusedFlowId(node.event.flowId);
                        const hit = contradictions.find((item) => item.relatedEventIds.includes(node.event.id));
                        setSelectedContradictionId(hit?.id ?? null);
                      }}
                    >
                      <rect x={node.x - 56} y={node.y - 18} rx={18} ry={18} width={112} height={56} />
                      <text x={node.x} y={node.y + 2} className="node-title">
                        {prettyType(node.event.type)}
                      </text>
                      <text x={node.x} y={node.y + 18} className="node-subtitle">
                        {formatEventTime(node.event.ts)}
                      </text>
                      {node.contradictionCount > 0 ? (
                        <>
                          <circle className="node-alert-badge" cx={node.x + 42} cy={node.y - 8} r={11} />
                          <text x={node.x + 42} y={node.y - 4} className="node-alert">
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
