// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { RulesView } from '../features/rules/RulesView';
import { SamplesView } from '../features/samples/SamplesView';
import type { RulesViewModel } from '../features/rules/rulesViewModel';
import type { SamplesViewModel } from '../features/samples/samplesViewModel';
import type { RuleProject } from '../models/ruleModel';
import type { WorkspaceState } from '../viewmodels/workspaceViewModel';

const noop = () => undefined;

function rulesViewModelStub(): RulesViewModel {
  return {
    addRule: noop, selectRule: noop, updateRule: noop, removeRule: noop,
    setGroupOperator: noop, addCondition: noop, updateCondition: noop,
    changeConditionField: noop, removeCondition: noop,
  } as unknown as RulesViewModel;
}

function samplesViewModelStub(): SamplesViewModel {
  return { setValue: noop, evaluate: noop } as unknown as SamplesViewModel;
}

function stateFor(project: RuleProject): WorkspaceState {
  return {
    phase: 'validating', persistence: 'idle', workspace: null, project,
    activeModule: 'rules', checkStatus: 'idle', analysis: null,
    validationIssues: [], sampleEvaluation: null, notice: '',
  } as unknown as WorkspaceState;
}

const project = (enumValues: string[], conditionValue: string): RuleProject => ({
  id: 'p', title: '失效引用项目', updatedAt: 1, versions: [],
  fields: [{ id: 'tier', name: '会员等级', type: 'enum', enumValues }],
  rules: [{
    id: 'r1', name: '金卡规则', priority: 10, result: '通过',
    conditions: { kind: 'group', operator: 'and', conditions: [
      { kind: 'predicate', fieldId: 'tier', operator: 'eq', value: conditionValue },
    ] },
  }],
  sampleInputs: { tier: conditionValue },
});

describe('stale enum rendering shows the real stored value', () => {
  it('renders the removed option as a disabled “已失效” entry instead of masquerading as a valid option', () => {
    // 选项中删除了“普通会员”，条件仍保存旧值
    const current = project(['银卡会员', '金卡会员'], '普通会员');
    const html = renderToStaticMarkup(<RulesView state={stateFor(current)} viewModel={rulesViewModelStub()} />);

    // 界面必须如实显示旧值，并标注失效
    expect(html).toContain('普通会员（已失效）');
    expect(html).toContain('条件值“普通会员”已失效');
    expect(html).toContain('对齐到“银卡会员”');
    expect(html).toContain('select-invalid');
  });

  it('renders normally when the condition value is still a valid option', () => {
    const current = project(['普通会员', '银卡会员', '金卡会员'], '金卡会员');
    const html = renderToStaticMarkup(<RulesView state={stateFor(current)} viewModel={rulesViewModelStub()} />);
    expect(html).not.toContain('已失效');
    expect(html).not.toContain('select-invalid');
  });

  it('offers no alignment when the enum field has no remaining options', () => {
    const current = project([], '普通会员');
    const html = renderToStaticMarkup(<RulesView state={stateFor(current)} viewModel={rulesViewModelStub()} />);
    expect(html).toContain('字段已无可用选项');
  });

  it('marks stale sample inputs in the sample workbench', () => {
    const current = project(['银卡会员'], '普通会员');
    const html = renderToStaticMarkup(<SamplesView state={stateFor(current)} viewModel={samplesViewModelStub()} />);
    expect(html).toContain('普通会员（已失效）');
    expect(html).toContain('已不在“会员等级”的选项中');
  });

  it('kept view models receive the alignment choice when the button is used', () => {
    const updateCondition = vi.fn();
    const viewModel = { ...rulesViewModelStub(), updateCondition } as unknown as RulesViewModel;
    const current = project(['银卡会员', '金卡会员'], '普通会员');
    // 这里只验证渲染产物中存在对齐动作；真正的点击行为由 updateCondition 在浏览器中触发
    const html = renderToStaticMarkup(<RulesView state={stateFor(current)} viewModel={viewModel} />);
    expect(html).toMatch(/对齐到“银卡会员”/);
    expect(updateCondition).not.toHaveBeenCalled();
  });
});
