import {
  CompiledImpliesRule,
  CompiledWorkflowRule,
  CompiledWorkflowSemantics,
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

const formatSemanticLabel = (value: string) =>
  value
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim()
    .split(/\s+/)
    .map((segment) => segment[0]?.toUpperCase() + segment.slice(1))
    .join(' ');

const formatDuration = (durationMs: number) => {
  if (durationMs % (60 * 60_000) === 0) {
    return `${durationMs / (60 * 60_000)}h`;
  }

  if (durationMs % 60_000 === 0) {
    return `${durationMs / 60_000}m`;
  }

  return `${Math.round(durationMs / 1_000)}s`;
};

const buildSuggestions = (
  rule: CompiledWorkflowRule,
  targetEvent: EventRecord,
  relatedEvents: EventRecord[],
): ReconciliationSuggestion[] => {
  if (rule.kind === 'requires') {
    return [
      {
        id: `${targetEvent.id}-requires-prereq`,
        title: 'Insert or verify the prerequisite',
        detail: `Confirm whether ${formatSemanticLabel(rule.sourceName)} should have occurred before ${formatSemanticLabel(rule.targetName)} and append a compensating event if telemetry is missing.`,
      },
      {
        id: `${targetEvent.id}-requires-audit`,
        title: 'Audit the causality chain',
        detail: `Review the upstream publisher for ${targetEvent.id} and verify the event was attached to the right flow before consumers act on it.`,
      },
    ];
  }

  if (rule.kind === 'forbids') {
    return [
      {
        id: `${targetEvent.id}-forbidden-compensate`,
        title: 'Choose the canonical branch',
        detail: `Decide whether ${formatSemanticLabel(rule.targetName)} or ${formatSemanticLabel(rule.sourceName)} should win, then append a compensating event so downstream consumers stop seeing both.`,
      },
      {
        id: `${targetEvent.id}-forbidden-source`,
        title: 'Quarantine the stale publisher',
        detail: `Trace which system emitted the conflicting event and suppress replayed or out-of-order writes until the branch is reconciled.`,
      },
    ];
  }

  if (rule.kind === 'within') {
    return [
      {
        id: `${targetEvent.id}-timing-window`,
        title: 'Investigate stale handoff timing',
        detail: `The elapsed time between ${formatSemanticLabel(rule.sourceName)} and ${formatSemanticLabel(rule.targetName)} exceeded ${rule.durationRaw}. Check queue lag, retries, and replayed webhooks.`,
      },
      {
        id: `${targetEvent.id}-timing-adjudicate`,
        title: 'Append an explicit adjudication marker',
        detail: 'If the step completed outside the intended SLA, add a late-arrival or exception event so timeline readers know the breach is understood.',
      },
    ];
  }

  if (rule.kind === 'implies') {
    return [
      {
        id: `${targetEvent.id}-implied-state`,
        title: 'Materialize the implied follow-up',
        detail: `Append an explicit ${formatSemanticLabel(rule.targetName)} marker or confirm the workflow intentionally skipped that implied state.`,
      },
    ];
  }

  return relatedEvents.length > 0
    ? [
        {
          id: `${targetEvent.id}-review`,
          title: 'Review related events',
          detail: `Inspect ${relatedEvents.map((event) => event.id).join(', ')} to determine whether the branch should be corrected or compensated.`,
        },
      ]
    : [];
};

export const sortEvents = (events: EventRecord[]) =>
  [...events].sort((left, right) => {
    const tsOrder = new Date(left.ts).getTime() - new Date(right.ts).getTime();
    if (tsOrder !== 0) {
      return tsOrder;
    }
    return left.id.localeCompare(right.id);
  });

export const deriveHypotheses = (events: EventRecord[], semantics: CompiledWorkflowSemantics): DerivedHypothesis[] =>
  sortEvents(events).flatMap((event) => {
    const mapping = stateHypothesisMap[event.type];
    const baseHypotheses: DerivedHypothesis[] = mapping
      ? [
          {
            id: `hyp-${event.id}`,
            flowId: event.flowId,
            sourceEventId: event.id,
            proposition: mapping.proposition,
            validFrom: event.ts,
            confidence: mapping.confidence,
            kind: event.type === 'PAYMENT_FAILED' || event.type === 'CANCELED' ? 'alert' : 'state',
          },
        ]
      : [];

    const impliedHypotheses = semantics.rules
      .filter((rule): rule is CompiledImpliesRule => rule.kind === 'implies' && rule.sourceEventType === event.type)
      .map((rule) => ({
        id: `hyp-${event.id}-${rule.targetName}`,
        flowId: event.flowId,
        sourceEventId: event.id,
        proposition:
          rule.targetKind === 'state'
            ? `${formatSemanticLabel(rule.targetName)} is now expected`
            : `${formatSemanticLabel(rule.targetName)} is implied by ${formatSemanticLabel(rule.sourceName)}`,
        validFrom: event.ts,
        confidence: rule.targetKind === 'state' ? 0.84 : 0.76,
        kind:
          /required|pause|hold|review|reconciliation/i.test(rule.targetName) ||
          event.type === 'PAYMENT_FAILED' ||
          event.type === 'CANCELED'
            ? ('alert' as const)
            : ('state' as const),
      }));

    return [...baseHypotheses, ...impliedHypotheses];
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

export const detectContradictions = (events: EventRecord[], semantics: CompiledWorkflowSemantics) => {
  const sorted = sortEvents(events);
  const contradictions: Contradiction[] = [];
  const byFlow = groupEventsByFlow(events);

  for (const [flowId, flowEvents] of byFlow.entries()) {
    for (const rule of semantics.rules) {
      if (rule.kind === 'requires') {
        if (!rule.targetEventType || !rule.sourceEventType) {
          continue;
        }

        flowEvents
          .filter((event) => event.type === rule.targetEventType)
          .forEach((targetEvent) => {
            const earlierEvents = flowEvents.filter(
              (candidate) => new Date(candidate.ts).getTime() <= new Date(targetEvent.ts).getTime(),
            );
            const prerequisite = earlierEvents.find((candidate) => candidate.type === rule.sourceEventType);

            if (prerequisite) {
              return;
            }

            contradictions.push({
              id: `cdx-${targetEvent.id}-requires-${rule.targetName}-${rule.sourceName}`,
              flowId,
              title: `Requires ${rule.targetName} <- ${rule.sourceName}`,
              summary: `${formatSemanticLabel(rule.targetName)} arrived without ${formatSemanticLabel(rule.sourceName)} earlier in the same flow.`,
              severity: 'high',
              relatedEventIds: [targetEvent.id],
              brokenRule: `requires ${rule.targetName} <- ${rule.sourceName}`,
              evidence: [`Missing prerequisite: ${formatSemanticLabel(rule.sourceName)} before ${targetEvent.id}.`],
              suggestions: buildSuggestions(rule, targetEvent, []),
            });
          });

        continue;
      }

      if (rule.kind === 'forbids') {
        if (!rule.targetEventType || !rule.sourceEventType) {
          continue;
        }

        flowEvents
          .filter((event) => event.type === rule.targetEventType)
          .forEach((targetEvent) => {
            const forbiddenEvents = flowEvents.filter(
              (candidate) => candidate.type === rule.sourceEventType && candidate.id !== targetEvent.id,
            );

            if (forbiddenEvents.length === 0) {
              return;
            }

            contradictions.push({
              id: `cdx-${targetEvent.id}-forbids-${rule.targetName}-${rule.sourceName}`,
              flowId,
              title: `Forbids ${rule.targetName} <- ${rule.sourceName}`,
              summary: `${formatSemanticLabel(rule.targetName)} overlaps the forbidden ${formatSemanticLabel(rule.sourceName)} branch.`,
              severity: forbiddenEvents.length > 1 ? 'high' : 'medium',
              relatedEventIds: [targetEvent.id, ...forbiddenEvents.map((event) => event.id)],
              brokenRule: `forbids ${rule.targetName} <- ${rule.sourceName}`,
              evidence: forbiddenEvents.map(
                (event) => `Forbidden overlap: ${formatSemanticLabel(rule.sourceName)} at ${event.ts}.`,
              ),
              suggestions: buildSuggestions(rule, targetEvent, forbiddenEvents),
            });
          });

        continue;
      }

      if (rule.kind === 'within') {
        if (!rule.targetEventType || !rule.sourceEventType) {
          continue;
        }

        flowEvents
          .filter((event) => event.type === rule.targetEventType)
          .forEach((targetEvent) => {
            const earlierSources = flowEvents
              .filter(
                (candidate) =>
                  candidate.type === rule.sourceEventType &&
                  new Date(candidate.ts).getTime() <= new Date(targetEvent.ts).getTime(),
              )
              .sort((left, right) => new Date(right.ts).getTime() - new Date(left.ts).getTime());

            const sourceEvent = earlierSources[0];

            if (!sourceEvent) {
              contradictions.push({
                id: `cdx-${targetEvent.id}-within-missing-${rule.targetName}-${rule.sourceName}`,
                flowId,
                title: `Within ${rule.targetName} <- ${rule.sourceName} ${rule.durationRaw}`,
                summary: `${formatSemanticLabel(rule.targetName)} has no earlier ${formatSemanticLabel(rule.sourceName)} anchor for its timing rule.`,
                severity: 'high',
                relatedEventIds: [targetEvent.id],
                brokenRule: `within ${rule.targetName} <- ${rule.sourceName} ${rule.durationRaw}`,
                evidence: [`Missing timing anchor: ${formatSemanticLabel(rule.sourceName)} before ${targetEvent.id}.`],
                suggestions: buildSuggestions(rule, targetEvent, []),
              });
              return;
            }

            const deltaMs = new Date(targetEvent.ts).getTime() - new Date(sourceEvent.ts).getTime();

            if (deltaMs <= rule.durationMs) {
              return;
            }

            contradictions.push({
              id: `cdx-${targetEvent.id}-within-${rule.targetName}-${rule.sourceName}`,
              flowId,
              title: `Within ${rule.targetName} <- ${rule.sourceName} ${rule.durationRaw}`,
              summary: `${formatSemanticLabel(rule.targetName)} happened ${formatDuration(deltaMs)} after ${formatSemanticLabel(rule.sourceName)}, exceeding ${rule.durationRaw}.`,
              severity: 'medium',
              relatedEventIds: [sourceEvent.id, targetEvent.id],
              brokenRule: `within ${rule.targetName} <- ${rule.sourceName} ${rule.durationRaw}`,
              evidence: [
                `${sourceEvent.id} recorded ${formatSemanticLabel(rule.sourceName)} at ${sourceEvent.ts}.`,
                `${targetEvent.id} recorded ${formatSemanticLabel(rule.targetName)} at ${targetEvent.ts}.`,
                `Observed latency: ${formatDuration(deltaMs)}. Allowed window: ${rule.durationRaw}.`,
              ],
              suggestions: buildSuggestions(rule, targetEvent, [sourceEvent]),
            });
          });

        continue;
      }

      if (rule.kind === 'implies' && rule.targetKind === 'event' && rule.sourceEventType && rule.targetEventType) {
        flowEvents
          .filter((event) => event.type === rule.sourceEventType)
          .forEach((sourceEvent) => {
            const impliedEvent = flowEvents.find(
              (candidate) =>
                candidate.type === rule.targetEventType &&
                new Date(candidate.ts).getTime() >= new Date(sourceEvent.ts).getTime(),
            );

            if (impliedEvent) {
              return;
            }

            contradictions.push({
              id: `cdx-${sourceEvent.id}-implies-${rule.sourceName}-${rule.targetName}`,
              flowId,
              title: `Implies ${rule.sourceName} -> ${rule.targetName}`,
              summary: `${formatSemanticLabel(rule.sourceName)} occurred without any later ${formatSemanticLabel(rule.targetName)} event in the same flow.`,
              severity: 'medium',
              relatedEventIds: [sourceEvent.id],
              brokenRule: `implies ${rule.sourceName} -> ${rule.targetName}`,
              evidence: [`${sourceEvent.id} implies ${formatSemanticLabel(rule.targetName)} but no matching event was observed.`],
              suggestions: buildSuggestions(rule, sourceEvent, []),
            });
          });
      }
    }
  }

  const deduped = Array.from(
    new Map(
      contradictions.map((item) => [
        `${item.flowId}-${item.brokenRule}-${item.relatedEventIds.slice().sort().join(',')}`,
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
