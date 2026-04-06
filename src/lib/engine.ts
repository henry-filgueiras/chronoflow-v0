import {
  ConstraintRule,
  Contradiction,
  DerivedHypothesis,
  EventRecord,
  EventType,
  ReconciliationSuggestion,
} from '../types';

const stateHypothesisMap: Partial<Record<EventType, { proposition: string; confidence: number }>> = {
  ORDER_CREATED: { proposition: 'Order exists in the workflow ledger', confidence: 0.98 },
  INVENTORY_RESERVED: { proposition: 'Inventory is reserved for fulfillment', confidence: 0.88 },
  PAYMENT_AUTHORIZED: { proposition: 'Payment is considered valid for fulfillment', confidence: 0.96 },
  PAYMENT_FAILED: { proposition: 'Payment path is unstable or rejected', confidence: 0.9 },
  PACKING_STARTED: { proposition: 'Order is actively being packed', confidence: 0.84 },
  PACKED: { proposition: 'Order is packed and staged', confidence: 0.91 },
  SHIPPED: { proposition: 'Shipment is in transit', confidence: 0.94 },
  DELIVERY_CONFIRMED: { proposition: 'Order is asserted as delivered', confidence: 0.95 },
  CANCELED: { proposition: 'Order is canceled and should stop progressing', confidence: 0.97 },
  RETURN_INITIATED: { proposition: 'A reverse-logistics path is active', confidence: 0.83 },
};

const severityRank = {
  high: 2,
  medium: 1,
} as const;

const formatTypeLabel = (value: string) =>
  value
    .toLowerCase()
    .split('_')
    .map((segment) => segment[0]?.toUpperCase() + segment.slice(1))
    .join(' ');

const parseReference = (value: string): EventType | null => {
  if (!value.startsWith('event:')) {
    return null;
  }
  return value.slice('event:'.length) as EventType;
};

const buildSuggestions = (rule: ConstraintRule, event: EventRecord, missing: EventType[], forbidden: EventRecord[]) => {
  const suggestions: ReconciliationSuggestion[] = [];

  if (missing.length > 0) {
    suggestions.push({
      id: `${event.id}-missing`,
      title: 'Insert or verify prerequisite events',
      detail: `Add earlier ${missing.map(formatTypeLabel).join(', ')} records or mark ${event.type} as speculative until those prerequisites exist.`,
    });
  }

  if (forbidden.length > 0) {
    suggestions.push({
      id: `${event.id}-forbidden`,
      title: 'Compensate or supersede the conflicting state',
      detail: `Either void ${event.type}, append a compensating event, or reconcile the conflicting ${forbidden.map((item) => item.type).join(', ')} path in the upstream source system.`,
    });
  }

  if (suggestions.length === 0) {
    suggestions.push({
      id: `${event.id}-review`,
      title: 'Review causality references',
      detail: `Audit the causality chain on ${event.id} and confirm the event belongs to ${event.flowId} at ${event.ts}.`,
    });
  }

  if (rule.when === 'PAYMENT_FAILED') {
    suggestions.push({
      id: `${event.id}-payments`,
      title: 'Open a payment reconciliation track',
      detail: 'Decide whether the payment failure is stale telemetry or whether fulfillment needs a return / hold event to restore consistency.',
    });
  }

  if (rule.when === 'CANCELED') {
    suggestions.push({
      id: `${event.id}-cancellation`,
      title: 'Append an explicit stop-the-line marker',
      detail: 'If downstream systems already shipped, add a compensating return or exception event so the cancellation does not remain ambiguous.',
    });
  }

  return suggestions;
};

export const sortEvents = (events: EventRecord[]) =>
  [...events].sort((left, right) => {
    const tsOrder = new Date(left.ts).getTime() - new Date(right.ts).getTime();
    if (tsOrder !== 0) {
      return tsOrder;
    }
    return left.id.localeCompare(right.id);
  });

export const deriveHypotheses = (events: EventRecord[]): DerivedHypothesis[] =>
  sortEvents(events).flatMap((event) => {
    const mapping = stateHypothesisMap[event.type];

    if (!mapping) {
      return [];
    }

    return [
      {
        id: `hyp-${event.id}`,
        flowId: event.flowId,
        sourceEventId: event.id,
        proposition: mapping.proposition,
        validFrom: event.ts,
        confidence: mapping.confidence,
        kind: event.type === 'PAYMENT_FAILED' || event.type === 'CANCELED' ? 'alert' : 'state',
      },
    ];
  });

export const groupEventsByFlow = (events: EventRecord[]) => {
  const grouped = new Map<string, EventRecord[]>();

  for (const event of sortEvents(events)) {
    const bucket = grouped.get(event.flowId) ?? [];
    bucket.push(event);
    grouped.set(event.flowId, bucket);
  }

  return grouped;
};

export const detectContradictions = (events: EventRecord[], rules: ConstraintRule[]) => {
  const sorted = sortEvents(events);
  const contradictions: Contradiction[] = [];
  const byFlow = groupEventsByFlow(events);

  for (const [flowId, flowEvents] of byFlow.entries()) {
    for (const rule of rules) {
      const targets = flowEvents.filter((event) => event.type === rule.when);

      for (const event of targets) {
        const earlierEvents = flowEvents.filter(
          (candidate) => new Date(candidate.ts).getTime() <= new Date(event.ts).getTime(),
        );
        const missing = (rule.requires ?? [])
          .map(parseReference)
          .filter((candidate): candidate is EventType => candidate !== null)
          .filter((requiredType) => !earlierEvents.some((candidate) => candidate.type === requiredType));

        const forbidden = (rule.forbids ?? [])
          .map(parseReference)
          .filter((candidate): candidate is EventType => candidate !== null)
          .flatMap((forbiddenType) =>
            flowEvents.filter(
              (candidate) =>
                candidate.type === forbiddenType &&
                candidate.id !== event.id,
            ),
          );

        if (missing.length === 0 && forbidden.length === 0) {
          continue;
        }

        contradictions.push({
          id: `cdx-${event.id}-${rule.name.replace(/\s+/g, '-').toLowerCase()}`,
          flowId,
          title: rule.name,
          summary:
            missing.length > 0
              ? `${formatTypeLabel(event.type)} arrived without ${missing.map(formatTypeLabel).join(', ')} beforehand.`
              : `${formatTypeLabel(event.type)} now overlaps a forbidden downstream state.`,
          severity: missing.length > 0 || forbidden.length > 1 ? 'high' : 'medium',
          relatedEventIds: [event.id, ...forbidden.map((item) => item.id)],
          brokenRule: rule.name,
          evidence: [
            ...missing.map((item) => `Missing prerequisite: ${formatTypeLabel(item)} before ${event.id}`),
            ...forbidden.map((item) => `Forbidden overlap: ${item.type} at ${item.ts}`),
          ],
          suggestions: buildSuggestions(rule, event, missing, forbidden),
        });
      }
    }

    const cancellation = flowEvents.find((event) => event.type === 'CANCELED');
    const delivery = flowEvents.find((event) => event.type === 'DELIVERY_CONFIRMED');
    if (cancellation && delivery) {
      contradictions.push({
        id: `cdx-${flowId}-cancel-vs-delivery`,
        flowId,
        title: 'Canceled and delivered simultaneously',
        summary: 'The same flow has both a cancellation path and a delivery confirmation path.',
        severity: 'high',
        relatedEventIds: [cancellation.id, delivery.id],
        brokenRule: 'Mutually exclusive terminal states',
        evidence: [
          `${cancellation.id} marks the order canceled at ${cancellation.ts}.`,
          `${delivery.id} claims final delivery at ${delivery.ts}.`,
        ],
        suggestions: [
          {
            id: `${flowId}-terminal-state`,
            title: 'Choose the canonical terminal state',
            detail: 'Append an adjudication event or rollback marker so consumers know whether cancellation or delivery won.',
          },
          {
            id: `${flowId}-trace`,
            title: 'Trace the upstream publisher',
            detail: 'Identify whether fulfillment or customer-service systems emitted the stale terminal event and quarantine that source.',
          },
        ],
      });
    }
  }

  const deduped = Array.from(
    new Map(
      contradictions.map((item) => [
        `${item.flowId}-${item.title}-${item.relatedEventIds.slice().sort().join(',')}`,
        item,
      ]),
    ).values(),
  );

  return deduped.sort((left, right) => {
    const severityDelta = severityRank[right.severity] - severityRank[left.severity];
    if (severityDelta !== 0) {
      return severityDelta;
    }

    const leftTs = Math.min(
      ...left.relatedEventIds
        .map((id) => sorted.find((event) => event.id === id))
        .filter((event): event is EventRecord => Boolean(event))
        .map((event) => new Date(event.ts).getTime()),
    );
    const rightTs = Math.min(
      ...right.relatedEventIds
        .map((id) => sorted.find((event) => event.id === id))
        .filter((event): event is EventRecord => Boolean(event))
        .map((event) => new Date(event.ts).getTime()),
    );

    return leftTs - rightTs;
  });
};
