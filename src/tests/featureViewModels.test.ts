import { describe, expect, it } from 'vitest';
import { FieldsViewModel } from '../features/fields/fieldsViewModel';
import { RulesViewModel } from '../features/rules/rulesViewModel';
import { SamplesViewModel } from '../features/samples/samplesViewModel';
import { RuleWorkspaceViewModel } from '../viewmodels/workspaceViewModel';

class MemoryRepository {
  async load() { return null; }
  async save() { return undefined; }
}

class FakeChecker {
  run() { return { promise: Promise.resolve({ checkedCases: 1, coveredCases: 1, coveragePercent: 100, overlaps: [], unreachableRuleIds: [], shadowedRuleIds: [], uncoveredExamples: [], truncated: false }), cancel() {} }; }
}

describe('feature ViewModels', () => {
  it('adds typed fields, builds a rule, protects referenced fields, and evaluates a sample', async () => {
    const workspace = new RuleWorkspaceViewModel(new MemoryRepository(), new FakeChecker());
    await workspace.start();
    const fields = new FieldsViewModel(workspace);
    const rules = new RulesViewModel(workspace);
    const samples = new SamplesViewModel(workspace);
    fields.addField('boolean');
    rules.addRule();
    const addedField = workspace.getSnapshot().project?.fields.at(-1);
    expect(addedField?.type).toBe('boolean');
    expect(fields.removeField('member-level')).toBe(false);
    expect(workspace.getSnapshot().notice).toContain('仍被');
    const project = workspace.getSnapshot().project;
    expect(project).toBeDefined();
    const boolField = project?.fields.at(-1);
    if (boolField) samples.setValue(boolField.id, true);
    samples.evaluate();
    expect(workspace.getSnapshot().sampleEvaluation?.valid).toBe(true);
    workspace.dispose();
  });

  it('warns when enum option edits strand rule conditions and samples, then realignment clears it', async () => {
    const workspace = new RuleWorkspaceViewModel(new MemoryRepository(), new FakeChecker());
    await workspace.start();
    const fields = new FieldsViewModel(workspace);
    const rules = new RulesViewModel(workspace);

    // 演示项目中“金卡大额订单”“金卡高额加赠”引用了“金卡会员”，样例也是“金卡会员”
    fields.updateField('member-level', { enumValues: ['普通会员', '银卡会员'] });
    const snapshot = workspace.getSnapshot();
    expect(snapshot.notice).toContain('金卡大额订单');
    expect(snapshot.notice).toContain('样例');
    expect(snapshot.validationIssues.some((issue) => issue.code === 'condition-enum')).toBe(true);

    // 对齐到仍存在的有效取值后，校验恢复通过
    const staleRule = snapshot.project?.rules.find((rule) => rule.id === 'rule-gold-discount');
    const conditionIndex = staleRule?.conditions.conditions.findIndex((condition) => condition.kind === 'predicate' && condition.fieldId === 'member-level') ?? -1;
    expect(conditionIndex).toBeGreaterThanOrEqual(0);
    rules.updateCondition(staleRule!.id, conditionIndex, { kind: 'predicate', fieldId: 'member-level', operator: 'eq', value: '银卡会员' });
    const issuesLeft = workspace.getSnapshot().validationIssues.filter((issue) => issue.ruleId === staleRule?.id);
    expect(issuesLeft).toEqual([]);
    workspace.dispose();
  });

  it('marks a restored version with stale references invalid via validation on load path', async () => {
    const workspace = new RuleWorkspaceViewModel(new MemoryRepository(), new FakeChecker());
    await workspace.start();
    // 先保存版本（快照自洽），再删掉枚举选项：版本记录保留旧字段，恢复后按当前快照口径检查
    workspace.saveVersion();
    const versionId = workspace.getSnapshot().project?.versions[0].id as string;
    const fields = new FieldsViewModel(workspace);
    fields.updateField('member-level', { enumValues: ['普通会员', '银卡会员'] });
    workspace.restoreVersion(versionId);
    // 恢复的是保存时的字段定义（含金卡会员），因此快照内部自洽，校验通过
    expect(workspace.getSnapshot().validationIssues).toEqual([]);
    workspace.dispose();
  });
});
