/**
 * A tiny declarative state machine.
 *
 * Every lifecycle in the platform (invoice, payroll batch, payment batch,
 * obligation) is declared as a transition map here rather than being implied by
 * scattered `status = 'X'` assignments. Two things fall out of that:
 *
 *  1. Illegal jumps (e.g. RECEIVED → PAID) are impossible, because services
 *     call `assertTransition` before writing.
 *  2. Every status change has a guaranteed `from`/`to` pair, which is exactly
 *     what the audit trail needs to record (PRD §29).
 */

export class IllegalTransitionError extends Error {
  readonly code = 'ILLEGAL_TRANSITION';

  constructor(
    readonly machine: string,
    readonly from: string,
    readonly to: string,
  ) {
    super(`${machine}: cannot move from ${from} to ${to}`);
    this.name = 'IllegalTransitionError';
  }
}

export interface StateMachine<S extends string> {
  readonly name: string;
  readonly states: readonly S[];
  readonly transitions: Readonly<Record<S, readonly S[]>>;
  canTransition(from: S, to: S): boolean;
  assertTransition(from: S, to: S): void;
  nextStates(from: S): readonly S[];
  /** Shortest path between two states, or null when unreachable. */
  pathBetween(from: S, to: S): S[] | null;
}

export function defineStateMachine<S extends string>(
  name: string,
  transitions: Record<S, readonly S[]>,
): StateMachine<S> {
  const states = Object.keys(transitions) as S[];

  return {
    name,
    states,
    transitions,
    canTransition(from, to) {
      if (from === to) return true;
      return (transitions[from] ?? []).includes(to);
    },
    assertTransition(from, to) {
      if (!this.canTransition(from, to)) throw new IllegalTransitionError(name, from, to);
    },
    nextStates(from) {
      return transitions[from] ?? [];
    },
    pathBetween(from, to) {
      if (from === to) return [from];
      const queue: S[][] = [[from]];
      const seen = new Set<S>([from]);
      while (queue.length) {
        const path = queue.shift()!;
        const tail = path[path.length - 1]!;
        for (const next of transitions[tail] ?? []) {
          if (seen.has(next)) continue;
          const extended = [...path, next];
          if (next === to) return extended;
          seen.add(next);
          queue.push(extended);
        }
      }
      return null;
    },
  };
}
