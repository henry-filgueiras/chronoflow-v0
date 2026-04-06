import {
  CompiledWorkflowSemantics,
  EventType,
  WorkflowAst,
  WorkflowDeclaration,
  WorkflowDslParseError,
  WorkflowDslParseResult,
  WorkflowProgramAst,
} from '../types';

const identifierPattern = String.raw`([A-Za-z_][A-Za-z0-9_]*)`;

const durationUnits: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 60 * 60_000,
  d: 24 * 60 * 60_000,
};

const eventAliases: Partial<Record<string, EventType>> = {
  SHIPMENTCONFIRMED: 'SHIPPED',
  PAYMENTAUTHORISED: 'PAYMENT_AUTHORIZED',
  PAYMENTDECLINED: 'PAYMENT_FAILED',
  REFUNDISSUED: 'RETURN_INITIATED',
};

const normalizeSymbol = (value: string) => value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();

const stripComment = (line: string) => line.replace(/\s*(\/\/|#).*$/, '').trim();

const buildEventLookup = (eventTypes: EventType[]) => {
  const lookup = new Map<string, EventType>();

  eventTypes.forEach((eventType) => {
    lookup.set(normalizeSymbol(eventType), eventType);
    lookup.set(normalizeSymbol(eventType.toLowerCase()), eventType);
    lookup.set(normalizeSymbol(eventType.toLowerCase().replace(/_/g, ' ')), eventType);
    lookup.set(normalizeSymbol(eventType.toLowerCase().replace(/_/g, '')), eventType);
  });

  Object.entries(eventAliases).forEach(([alias, eventType]) => {
    if (eventType) {
      lookup.set(alias, eventType);
    }
  });

  return lookup;
};

const parseDuration = (raw: string) => {
  const match = raw.match(/^(\d+)([smhd])$/i);
  if (!match) {
    return null;
  }

  return Number(match[1]) * durationUnits[match[2].toLowerCase()];
};

export const parseWorkflowDsl = (source: string): WorkflowDslParseResult => {
  const lines = source.split(/\r?\n/);
  const errors: WorkflowDslParseError[] = [];
  const workflows: WorkflowAst[] = [];

  let index = 0;

  while (index < lines.length) {
    const rawLine = stripComment(lines[index]);
    const lineNumber = index + 1;

    if (!rawLine) {
      index += 1;
      continue;
    }

    const workflowMatch = rawLine.match(new RegExp(`^workflow\\s+${identifierPattern}\\s*\\{$`));
    if (!workflowMatch) {
      errors.push({
        line: lineNumber,
        message: 'Expected `workflow <name> {`.',
      });
      index += 1;
      continue;
    }

    const workflow: WorkflowAst = {
      name: workflowMatch[1],
      line: lineNumber,
      declarations: [],
      rules: [],
    };

    index += 1;
    let closed = false;

    while (index < lines.length) {
      const bodyLine = stripComment(lines[index]);
      const bodyLineNumber = index + 1;

      if (!bodyLine) {
        index += 1;
        continue;
      }

      if (bodyLine === '}') {
        closed = true;
        index += 1;
        break;
      }

      const eventMatch = bodyLine.match(new RegExp(`^event\\s+${identifierPattern}$`));
      if (eventMatch) {
        workflow.declarations.push({
          kind: 'event',
          name: eventMatch[1],
          line: bodyLineNumber,
        });
        index += 1;
        continue;
      }

      const stateMatch = bodyLine.match(new RegExp(`^state\\s+${identifierPattern}$`));
      if (stateMatch) {
        workflow.declarations.push({
          kind: 'state',
          name: stateMatch[1],
          line: bodyLineNumber,
        });
        index += 1;
        continue;
      }

      const requiresMatch = bodyLine.match(new RegExp(`^requires\\s+${identifierPattern}\\s*<-\\s*${identifierPattern}$`));
      if (requiresMatch) {
        workflow.rules.push({
          kind: 'requires',
          target: requiresMatch[1],
          source: requiresMatch[2],
          line: bodyLineNumber,
        });
        index += 1;
        continue;
      }

      const forbidsMatch = bodyLine.match(new RegExp(`^forbids\\s+${identifierPattern}\\s*<-\\s*${identifierPattern}$`));
      if (forbidsMatch) {
        workflow.rules.push({
          kind: 'forbids',
          target: forbidsMatch[1],
          source: forbidsMatch[2],
          line: bodyLineNumber,
        });
        index += 1;
        continue;
      }

      const impliesMatch = bodyLine.match(new RegExp(`^implies\\s+${identifierPattern}\\s*->\\s*${identifierPattern}$`));
      if (impliesMatch) {
        workflow.rules.push({
          kind: 'implies',
          source: impliesMatch[1],
          target: impliesMatch[2],
          line: bodyLineNumber,
        });
        index += 1;
        continue;
      }

      const withinMatch = bodyLine.match(
        new RegExp(`^within\\s+${identifierPattern}\\s*<-\\s*${identifierPattern}\\s+(\\d+[smhd])$`, 'i'),
      );
      if (withinMatch) {
        const durationMs = parseDuration(withinMatch[3]);

        if (durationMs === null) {
          errors.push({
            line: bodyLineNumber,
            message: 'Unsupported duration. Use values like `30s`, `5m`, `2h`, or `1d`.',
          });
        } else {
          workflow.rules.push({
            kind: 'within',
            target: withinMatch[1],
            source: withinMatch[2],
            durationMs,
            durationRaw: withinMatch[3],
            line: bodyLineNumber,
          });
        }

        index += 1;
        continue;
      }

      errors.push({
        line: bodyLineNumber,
        message: 'Unrecognized statement inside workflow block.',
      });
      index += 1;
    }

    if (!closed) {
      errors.push({
        line: workflow.line,
        message: `Workflow \`${workflow.name}\` is missing a closing \`}\`.`,
      });
    }

    workflows.push(workflow);
  }

  return {
    ast: errors.length > 0 ? null : { workflows },
    errors,
  };
};

export const compileWorkflowSemantics = (
  ast: WorkflowProgramAst,
  availableEvents: EventType[],
): CompiledWorkflowSemantics => {
  const warnings: string[] = [];
  const declarations: WorkflowDeclaration[] = [];
  const rules: CompiledWorkflowSemantics['rules'] = [];
  const eventLookup = buildEventLookup(availableEvents);
  const declarationKinds = new Map<string, 'event' | 'state'>();

  ast.workflows.forEach((workflow) => {
    workflow.declarations.forEach((declaration) => {
      const key = normalizeSymbol(declaration.name);
      declarationKinds.set(key, declaration.kind);

      if (declaration.kind === 'event') {
        const eventType = eventLookup.get(key);
        if (!eventType) {
          warnings.push(
            `Workflow ${workflow.name}: event \`${declaration.name}\` does not match a known ledger event type.`,
          );
        }

        declarations.push({
          kind: 'event',
          name: declaration.name,
          eventType,
        });
      } else {
        declarations.push({
          kind: 'state',
          name: declaration.name,
        });
      }
    });

    workflow.rules.forEach((rule) => {
      if (rule.kind === 'implies') {
        const sourceEventType = eventLookup.get(normalizeSymbol(rule.source));
        const targetEventType = eventLookup.get(normalizeSymbol(rule.target));
        const targetKind =
          declarationKinds.get(normalizeSymbol(rule.target)) ??
          (targetEventType ? 'event' : 'state');

        if (!sourceEventType) {
          warnings.push(`Workflow ${workflow.name}: implies source \`${rule.source}\` has no matching event type.`);
        }

        rules.push({
          kind: 'implies',
          workflowName: workflow.name,
          sourceName: rule.source,
          targetName: rule.target,
          sourceEventType,
          targetEventType,
          targetKind,
          line: rule.line,
        });
        return;
      }

      const targetEventType = eventLookup.get(normalizeSymbol(rule.target));
      const sourceEventType = eventLookup.get(normalizeSymbol(rule.source));

      if (!targetEventType) {
        warnings.push(`Workflow ${workflow.name}: \`${rule.target}\` has no matching event type.`);
      }

      if (!sourceEventType) {
        warnings.push(`Workflow ${workflow.name}: \`${rule.source}\` has no matching event type.`);
      }

      if (rule.kind === 'requires') {
        rules.push({
          kind: 'requires',
          workflowName: workflow.name,
          targetName: rule.target,
          sourceName: rule.source,
          targetEventType,
          sourceEventType,
          line: rule.line,
        });
      } else if (rule.kind === 'forbids') {
        rules.push({
          kind: 'forbids',
          workflowName: workflow.name,
          targetName: rule.target,
          sourceName: rule.source,
          targetEventType,
          sourceEventType,
          line: rule.line,
        });
      } else {
        rules.push({
          kind: 'within',
          workflowName: workflow.name,
          targetName: rule.target,
          sourceName: rule.source,
          targetEventType,
          sourceEventType,
          durationMs: rule.durationMs,
          durationRaw: rule.durationRaw,
          line: rule.line,
        });
      }
    });
  });

  return {
    ast,
    declarations,
    rules,
    warnings,
  };
};
