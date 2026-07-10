import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ElementRegistry } from '../../src/content/element-registry';
import { buildPageSnapshot } from '../../src/content/page-observer';
import { PageSnapshotSchema } from '../../src/protocol/page-snapshot';

const visibleBounds = {
  x: 0,
  y: 0,
  top: 0,
  right: 160,
  bottom: 32,
  left: 0,
  width: 160,
  height: 32,
  toJSON: () => ({}),
};

describe('buildPageSnapshot', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = '<head></head><body></body>';
    (
      window as unknown as {
        happyDOM: { setURL: (url: string) => void };
      }
    ).happyDOM.setURL('https://app.example.test/customers/new?source=lead');
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      visibleBounds,
    );
  });

  it('builds a compact semantic snapshot without exposing field values', () => {
    document.title = 'Customer Console / Create';
    document.documentElement.lang = 'zh-CN';
    document.documentElement.dataset.agentPageType = 'customer.create';
    document.body.innerHTML = `
      <main>
        <h1>Create customer</h1>
        <p data-agent-summary>Capture the account owner and contact details.</p>
        <p style="display: none">classified hidden phrase</p>
        <form
          id="customer-create"
          data-agent-form="customer-create"
          data-agent-label="Customer profile"
        >
          <label>Name <input name="name" value="Ada Lovelace" required /></label>
          <label>
            Access secret
            <input name="password" type="password" value="ultra-secret-demo" />
          </label>
          <input type="hidden" name="csrf-token" value="hidden-token" />
          <button
            type="submit"
            data-agent-action="customer.create"
            data-agent-risk="server-write"
          >
            Save customer
          </button>
        </form>
        <table aria-label="Recent customers">
          <thead><tr><th>Name</th><th>Status</th></tr></thead>
          <tbody><tr><td>Grace</td><td>Active</td></tr></tbody>
        </table>
        <p role="status">Draft is not saved.</p>
      </main>
    `;

    const snapshot = buildPageSnapshot(
      document,
      window,
      new ElementRegistry(1, 'snapshot_test'),
    );

    expect(PageSnapshotSchema.parse(snapshot)).toEqual(snapshot);
    expect(snapshot.pageType).toBe('customer.create');
    expect(snapshot.route).toBe('/customers/new?source=lead');
    expect(snapshot.headings[0]?.text).toBe('Create customer');
    expect(snapshot.forms).toHaveLength(1);
    expect(snapshot.forms[0]?.formId).toBe('customer-create');
    expect(snapshot.forms[0]?.fields).toHaveLength(2);
    expect(snapshot.forms[0]?.submitActions).toHaveLength(1);
    expect(snapshot.actions[0]).toMatchObject({
      label: 'Save customer',
      declaredAction: 'customer.create',
      declaredRisk: 'server-write',
    });
    expect(snapshot.tables[0]).toMatchObject({
      label: 'Recent customers',
      headers: ['Name', 'Status'],
      rowCount: 2,
      columnCount: 2,
    });
    expect(snapshot.alerts[0]?.text).toBe('Draft is not saved.');
    expect(snapshot.visibleTextSummary).toContain(
      'Capture the account owner and contact details.',
    );
    expect(snapshot.visibleTextSummary).not.toContain('classified hidden phrase');

    const passwordField = snapshot.forms[0]?.fields.find(
      (field) => field.name === 'password',
    );
    expect(passwordField).toMatchObject({
      label: 'Access secret',
      sensitive: true,
    });
    expect(passwordField).not.toHaveProperty('hasValue');
    expect(JSON.stringify(snapshot)).not.toContain('ultra-secret-demo');
    expect(JSON.stringify(snapshot)).not.toContain('hidden-token');
  });

  it('scopes node identifiers to the registry generation', () => {
    document.body.innerHTML = '<main><h1>One heading</h1></main>';

    const firstSnapshot = buildPageSnapshot(
      document,
      window,
      new ElementRegistry(4, 'snapshot_four'),
    );
    const secondSnapshot = buildPageSnapshot(
      document,
      window,
      new ElementRegistry(5, 'snapshot_five'),
    );

    expect(firstSnapshot.headings[0]?.nodeId).toMatch(/^node_4_/);
    expect(secondSnapshot.headings[0]?.nodeId).toMatch(/^node_5_/);
    expect(firstSnapshot.headings[0]?.nodeId).not.toBe(
      secondSnapshot.headings[0]?.nodeId,
    );
  });
});
