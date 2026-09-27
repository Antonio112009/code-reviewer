import { compareSkills } from './detector';
import type { Skill } from './loader';

export interface SkillSummary {
  id: string;
  name: string;
  category: string;
  description: string;
}

/** Read-only view of the loaded skills for the on-demand `list_skills` / `get_skill` tools. */
export interface SkillCatalog {
  list(): SkillSummary[];
  /** Full checklist body, or `undefined` for an unknown id. */
  get(id: string): string | undefined;
}

/** Builds a catalog over `skills` (prompt order), hiding the ids in `exclude` (`review.skillsExclude`). */
export function createSkillCatalog(skills: Skill[], exclude: string[] = []): SkillCatalog {
  const excluded = new Set(exclude);
  const visible = skills.filter((s) => !excluded.has(s.id)).sort(compareSkills);
  const byId = new Map(visible.map((s) => [s.id, s]));
  const summaries = visible.map(({ id, name, category, description }) => ({
    id,
    name,
    category,
    description,
  }));
  return {
    list: () => summaries.map((s) => ({ ...s })),
    get: (id) => byId.get(id)?.body,
  };
}
