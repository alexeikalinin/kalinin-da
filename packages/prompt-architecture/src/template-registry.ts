import type { RoleId } from "@ama/agent-framework";
import type { Actor } from "@ama/memory";

export interface RoleTemplate {
  readonly roleId: RoleId;
  readonly version: number;
  readonly purpose: string;
  readonly responsibility: string;
}

// Prompt Architecture §3/§4 — every version of the "Роль" block template is
// kept, not overwritten, so Reflection can later compare outcomes by
// version. Publishing a new version as the active one always requires an
// approver — same "no autonomous critical change" principle used
// throughout (Agent Framework §4a, Knowledge Base §2).
export class RoleTemplateRegistry {
  #history = new Map<RoleId, RoleTemplate[]>();
  #active = new Map<RoleId, number>();

  propose(roleId: RoleId, purpose: string, responsibility: string): RoleTemplate {
    const history = this.#history.get(roleId) ?? [];
    const template: RoleTemplate = { roleId, version: history.length + 1, purpose, responsibility };
    history.push(template);
    this.#history.set(roleId, history);
    return template;
  }

  publish(actor: Actor, roleId: RoleId, version: number): void {
    if (actor.kind !== "approver") {
      throw new Error("Only an approver can publish a prompt template version as active.");
    }
    const exists = this.#history.get(roleId)?.some((t) => t.version === version);
    if (!exists) {
      throw new Error(`Unknown template version ${version} for role "${roleId}".`);
    }
    this.#active.set(roleId, version);
  }

  getActive(roleId: RoleId): RoleTemplate | undefined {
    const version = this.#active.get(roleId);
    if (version === undefined) return undefined;
    return this.#history.get(roleId)?.find((t) => t.version === version);
  }

  history(roleId: RoleId): readonly RoleTemplate[] {
    return this.#history.get(roleId) ?? [];
  }
}
