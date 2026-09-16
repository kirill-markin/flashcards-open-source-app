import type { AgentToolActions, AgentToolSurface } from "./types";

/**
 * Binds one action that no tool registered on this surface reaches. An adapter names every action
 * rather than spreading a shared default, so an action it has not injected is a type error there,
 * and a tool added to the surface later that reaches this one fails loudly instead of calling
 * production code around the surface's dependencies and its tests' fakes.
 *
 * Every action is bound for real on both surfaces today, so nothing calls this. It is kept for the
 * next action a surface does not implement, which `AgentToolActions` still forces that surface to
 * name.
 */
export function unboundAgentToolAction<Name extends keyof AgentToolActions>(
  actionName: Name,
  surface: AgentToolSurface,
): AgentToolActions[Name] {
  const reject = (): never => {
    throw new Error(
      `The ${actionName} action is not bound on the ${surface} surface: inject it from that surface's dependencies before registering a tool that reaches it.`,
    );
  };

  // Every action returns a promise and `never` satisfies each one; the assertion only drops the
  // parameter list, which a thrower never reads.
  return reject as AgentToolActions[Name];
}
