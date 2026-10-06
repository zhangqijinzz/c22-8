import { describe, expect, it } from 'vitest';
import type { WorkspaceDocument } from '../models/ruleModel';
import { RuleRepository } from '../repositories/ruleRepository';
import { ProjectStorageService } from '../services/projectStorageService';

class FakeStorage extends ProjectStorageService {
  constructor(private readonly stored: unknown) {
    super();
  }

  override async read(): Promise<unknown | null> {
    return this.stored;
  }

  override readFallback(): unknown | null {
    return null;
  }

  override async write(): Promise<void> {
    return undefined;
  }
}

const staleRule = {
  id: 'r1',
  name: '金卡规则',
  priority: 10,
  result: '9 折',
  conditions: { kind: 'group', operator: 'and', conditions: [
    { kind: 'predicate', fieldId: 'tier', operator: 'eq', value: 'platinum' },
  ] },
};

const staleDocument = {
  schemaVersion: 1,
  activeProjectId: 'p1',
  projects: [{
    id: 'p1',
    title: '旧项目',
    updatedAt: 1,
    fields: [{ id: 'tier', name: '等级', type: 'enum', enumValues: ['basic', 'gold'] }],
    rules: [staleRule],
    sampleInputs: { tier: 'platinum' },
    versions: [{
      id: 'v1',
      name: '版本 1',
      savedAt: 1,
      frozen: true,
      fields: [{ id: 'tier', name: '等级', type: 'enum', enumValues: ['basic', 'gold'] }],
      rules: [staleRule],
      sampleInputs: { tier: 'platinum' },
    }],
    frozenVersionId: 'v1',
  }],
};

describe('RuleRepository', () => {
  it('reconciles stale enum references in saved projects and version snapshots on load', async () => {
    const repository = new RuleRepository(new FakeStorage(staleDocument));
    const workspace = (await repository.load()) as WorkspaceDocument;
    const project = workspace.projects[0];
    const condition = project.rules[0].conditions.conditions[0];
    expect(condition.kind === 'predicate' && condition.value).toBe('basic');
    expect(project.sampleInputs['tier']).toBe('basic');
    const version = project.versions[0];
    const versionCondition = version.rules[0].conditions.conditions[0];
    expect(versionCondition.kind === 'predicate' && versionCondition.value).toBe('basic');
    expect(version.sampleInputs['tier']).toBe('basic');
    expect(project.frozenVersionId).toBe('v1');
  });

  it('still rejects documents that fail structural checks', async () => {
    const repository = new RuleRepository(new FakeStorage({ schemaVersion: 1, projects: [], activeProjectId: 'nope' }));
    expect(await repository.load()).toBeNull();
  });
});
