import { FormEvent, useEffect, useMemo, useState } from 'react';
import { constraintRules, eventTypes, sampleLedger } from './data/sampleData';
import { detectContradictions, deriveHypotheses, sortEvents } from './lib/engine';
import { buildGraphLayout, buildTicks } from './lib/graph';
import { EventFormState, EventRecord, GraphEdge, GraphNode } from './types';

const storageKey = 'chronoflow-v0-ledger';

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

const findNode = (nodes: GraphNode[], id: string) => nodes.find((node) => node.event.id === id);

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

  useEffect(() => {
    window.localStorage.setItem(storageKey, JSON.stringify(ledger));
  }, [ledger]);

  const orderedLedger = useMemo(() => sortEvents(ledger), [ledger]);
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

  const contradictionCounts = useMemo(() => {
    const counts = new Map<string, number>();

    contradictions.forEach((item) => {
      item.relatedEventIds.forEach((eventId) => {
        counts.set(eventId, (counts.get(eventId) ?? 0) + 1);
      });
    });

    return counts;
  }, [contradictions]);

  const selectedContradiction = useMemo(
    () =>
      selectedContradictionId === null
        ? null
        : contradictions.find((item) => item.id === selectedContradictionId) ?? contradictions[0] ?? null,
    [contradictions, selectedContradictionId],
  );
  const selectedEvent = useMemo(
    () => orderedLedger.find((item) => item.id === selectedEventId) ?? null,
    [orderedLedger, selectedEventId],
  );

  const graph = useMemo(() => buildGraphLayout(orderedLedger, contradictionCounts), [orderedLedger, contradictionCounts]);
  const ticks = useMemo(() => buildTicks(graph.bounds), [graph.bounds]);

  const activeEventIds = useMemo(() => {
    if (selectedContradiction) {
      return new Set(selectedContradiction.relatedEventIds);
    }

    if (selectedEventId) {
      return new Set([selectedEventId]);
    }

    return new Set<string>();
  }, [selectedContradiction, selectedEventId]);

  const highlightedFlowId = selectedContradiction?.flowId ?? selectedEvent?.flowId ?? null;

  const appendEvent = (event: EventRecord) => {
    setLedger((current) => [...current, event]);
    setSelectedEventId(event.id);
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

  const resetToSample = () => {
    setLedger(sampleLedger);
    setSelectedEventId(null);
    setSelectedContradictionId(null);
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

        <section className="panel center-panel">
          <div className="panel-heading">
            <div>
              <p className="section-label">Temporal graph</p>
              <h2>Causal timeline</h2>
            </div>
            <p className="graph-caption">Nodes are time-indexed by event timestamp; dotted arcs show causal references.</p>
          </div>

          <div className="graph-surface">
            <svg viewBox={`0 0 ${graph.width} ${graph.height}`} role="img" aria-label="Temporal graph of order events">
              <defs>
                <marker id="arrowhead" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
                  <path d="M0,0 L8,4 L0,8 Z" fill="var(--line-causal)" />
                </marker>
              </defs>

              {graph.flowIds.map((flowId, lane) => {
                const y = 112 + lane * 190;
                const isActive = highlightedFlowId ? highlightedFlowId === flowId : true;
                return (
                  <g key={flowId} opacity={isActive ? 1 : 0.28}>
                    <text className="flow-label" x={20} y={y}>
                      {flowId}
                    </text>
                    <line className="lane-line" x1={120} y1={y + 18} x2={graph.width - 80} y2={y + 18} />
                  </g>
                );
              })}

              {ticks.map((tick) => (
                <g key={tick.value}>
                  <line className="tick-line" x1={tick.x} y1={46} x2={tick.x} y2={graph.height - 30} />
                  <text className="tick-label" x={tick.x} y={26}>
                    {tick.label}
                  </text>
                </g>
              ))}

              {graph.edges.map((edge) => {
                const source = findNode(graph.nodes, edge.sourceId);
                const target = findNode(graph.nodes, edge.targetId);
                if (!source || !target) {
                  return null;
                }

                const isActive = activeEventIds.size === 0 || (activeEventIds.has(source.event.id) && activeEventIds.has(target.event.id));
                const midX = (source.x + target.x) / 2;
                const bend = edge.kind === 'causal' ? 64 : 22;

                return (
                  <path
                    key={edge.id}
                    className={`graph-edge ${edge.kind}`}
                    d={`M ${source.x} ${source.y + 36} C ${midX} ${source.y + bend}, ${midX} ${target.y - bend}, ${target.x} ${
                      target.y - 12
                    }`}
                    stroke={edgeStroke(edge)}
                    markerEnd={edge.kind === 'causal' ? 'url(#arrowhead)' : undefined}
                    opacity={isActive ? 0.95 : 0.2}
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
                    opacity={isDimmed ? 0.2 : 1}
                    onClick={() => {
                      setSelectedEventId(node.event.id);
                      const hit = contradictions.find((item) => item.relatedEventIds.includes(node.event.id));
                      if (hit) {
                        setSelectedContradictionId(hit.id);
                      }
                    }}
                  >
                    <rect x={node.x - 62} y={node.y - 18} rx={22} ry={22} width={124} height={68} />
                    <text x={node.x} y={node.y + 4} className="node-title">
                      {prettyType(node.event.type)}
                    </text>
                    <text x={node.x} y={node.y + 22} className="node-subtitle">
                      {formatEventTime(node.event.ts)}
                    </text>
                    {node.contradictionCount > 0 ? (
                      <text x={node.x + 46} y={node.y - 2} className="node-alert">
                        {node.contradictionCount}
                      </text>
                    ) : null}
                  </g>
                );
              })}
            </svg>
          </div>

          <div className="hypothesis-strip">
            <div className="panel-heading compact">
              <div>
                <p className="section-label">Hypothesis nodes</p>
                <h3>Derived state assumptions</h3>
              </div>
            </div>
            <div className="hypothesis-grid">
              {hypotheses.map((hypothesis) => (
                <article key={hypothesis.id} className={`hypothesis-card ${hypothesis.kind}`}>
                  <span>{hypothesis.flowId}</span>
                  <strong>{hypothesis.proposition}</strong>
                  <p>
                    Valid from {formatEventTime(hypothesis.validFrom)} · confidence {(hypothesis.confidence * 100).toFixed(0)}%
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <aside className="panel right-panel">
          <div className="panel-heading">
            <div>
              <p className="section-label">Contradictions</p>
              <h2>Detection + reconciliation</h2>
            </div>
          </div>

          <div className="contradiction-list">
            {contradictions.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`contradiction-card ${selectedContradiction?.id === item.id ? 'selected' : ''} ${item.severity}`}
                onClick={() => {
                  setSelectedContradictionId(item.id);
                  setSelectedEventId(null);
                }}
              >
                <div className="contradiction-header">
                  <span className={`severity-pill ${item.severity}`}>{item.severity}</span>
                  <span>{item.flowId}</span>
                </div>
                <strong>{item.title}</strong>
                <p>{item.summary}</p>
              </button>
            ))}
          </div>

          {selectedContradiction ? (
            <div className="detail-stack">
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
                    const event = orderedLedger.find((candidate) => candidate.id === eventId);
                    if (!event) {
                      return null;
                    }

                    return (
                      <button
                        key={eventId}
                        className="related-event"
                        type="button"
                        onClick={() => setSelectedEventId(eventId)}
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
                    Causality refs:{' '}
                    {selectedEvent.causalityRefs.length > 0 ? selectedEvent.causalityRefs.join(', ') : 'none'}
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
              <strong>No contradictions detected.</strong>
              <p>Append events on the left to stress the rules engine.</p>
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}

export default App;
