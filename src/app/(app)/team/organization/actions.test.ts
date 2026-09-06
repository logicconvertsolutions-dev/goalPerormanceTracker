// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockGetSessionAgent = vi.fn();
vi.mock('@/lib/auth/session', () => ({
  getSessionAgent: (...args: unknown[]) => mockGetSessionAgent(...args),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

let mockCreateClient: ReturnType<typeof vi.fn>;
vi.mock('@/lib/supabase/server', () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...args),
}));

const { removeOrgLogoAction } = await import('./actions');

type QueryResult = { data?: unknown; error: unknown };

// `organizations` is queried twice in removeOrgLogoAction -- once via
// select().eq().maybeSingle(), once via update().eq() (awaited directly,
// since the query builder itself is thenable). Track which verb started the
// chain so the same mock can resolve either shape.
function createOrgTableMock(selectResult: QueryResult, updateResult: QueryResult) {
  return vi.fn(() => {
    let mode: 'select' | 'update' = 'select';
    const builder: Record<string, unknown> = {
      select: vi.fn(() => {
        mode = 'select';
        return builder;
      }),
      update: vi.fn(() => {
        mode = 'update';
        return builder;
      }),
      eq: vi.fn(() => builder),
      maybeSingle: vi.fn(() => Promise.resolve(selectResult)),
      then: (resolve: (v: QueryResult) => void, reject: (e: unknown) => void) =>
        Promise.resolve(mode === 'update' ? updateResult : selectResult).then(resolve, reject),
    };
    return builder;
  });
}

function setupSupabase({
  selectResult = { data: { logo_path: 'org-1/logo.png' }, error: null },
  updateResult = { error: null },
  removeResult = { error: null },
}: {
  selectResult?: QueryResult;
  updateResult?: QueryResult;
  removeResult?: { error: unknown };
} = {}) {
  const from = createOrgTableMock(selectResult, updateResult);
  const remove = vi.fn().mockResolvedValue(removeResult);
  mockCreateClient.mockResolvedValue({
    from,
    storage: { from: vi.fn(() => ({ remove })) },
  });
  return { from, remove };
}

describe('removeOrgLogoAction', () => {
  beforeEach(() => {
    mockGetSessionAgent.mockReset();
    mockCreateClient = vi.fn();
  });

  it('returns not signed in when there is no session', async () => {
    mockGetSessionAgent.mockResolvedValue(null);

    const result = await removeOrgLogoAction();

    expect(result).toEqual({ ok: false, error: 'Not signed in.' });
  });

  it('returns an error when the org has no logo to remove', async () => {
    mockGetSessionAgent.mockResolvedValue({ agent: { org_id: 'org-1' } });
    const { remove } = setupSupabase({ selectResult: { data: { logo_path: null }, error: null } });

    const result = await removeOrgLogoAction();

    expect(result).toEqual({ ok: false, error: 'No logo to remove.' });
    expect(remove).not.toHaveBeenCalled();
  });

  it('removes the stored file and clears logo_path', async () => {
    mockGetSessionAgent.mockResolvedValue({ agent: { org_id: 'org-1' } });
    const { remove } = setupSupabase();

    const result = await removeOrgLogoAction();

    expect(result).toEqual({ ok: true, error: undefined });
    expect(remove).toHaveBeenCalledWith(['org-1/logo.png']);
  });

  it('surfaces a storage error without clearing logo_path', async () => {
    mockGetSessionAgent.mockResolvedValue({ agent: { org_id: 'org-1' } });
    const { from } = setupSupabase({ removeResult: { error: { message: 'storage unavailable' } } });

    const result = await removeOrgLogoAction();

    expect(result).toEqual({ ok: false, error: 'storage unavailable' });
    // Only the initial select ran -- the function returns before issuing
    // the update() that would clear logo_path.
    expect(from).toHaveBeenCalledTimes(1);
  });
});
