import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Permission } from '@fpc/shared';
import { renderWithProviders } from '../test/render';
import { NAV_GROUPS, navItemVisible } from '@/lib/navigation';
import { CookbookPage } from './Cookbook';

/**
 * The handbook is the one page in the product that is not permission-gated,
 * because it explains the refusals as well as the actions. These assert both
 * halves of that: it is offered to a user holding nothing, and the links out
 * of it are still gated on the permission the target screen needs.
 */
const authState = vi.hoisted(() => ({ current: null as unknown }));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => authState.current,
}));

/**
 * A recipe title appears twice — in the index rail and as the recipe's own
 * heading — so the assertions name the heading rather than the text.
 */
const TDS_RECIPE = 'Verify an approved invoice and deduct TDS';
const verifyRecipe = () => screen.getByRole('heading', { name: TDS_RECIPE });
const queryVerifyRecipe = () => screen.queryByRole('heading', { name: TDS_RECIPE });

function signedInAs(permissions: Permission[]) {
  authState.current = {
    canAny: (...required: Permission[]) => required.some((entry) => permissions.includes(entry)),
  };
}

describe('Cookbook', () => {
  it('is offered in the menu to a user who holds no permissions at all', () => {
    const canAny = (...required: Permission[]) => required.length === 0;
    const items = NAV_GROUPS.flatMap((group) => group.items).filter((item) =>
      navItemVisible(item, canAny),
    );

    expect(items.map((item) => item.to)).toEqual(['/cookbook']);
  });

  it('narrows the handbook to one role, and back again', async () => {
    signedInAs([]);
    renderWithProviders(<CookbookPage />, { route: '/cookbook' });

    expect(verifyRecipe()).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Payroll' }));

    expect(queryVerifyRecipe()).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Import a payroll run and get it approved' }),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Everyone' }));
    expect(verifyRecipe()).toBeInTheDocument();
  });

  it('offers a link to a screen only when the reader may open it', () => {
    signedInAs(['invoice:verify']);
    const { unmount } = renderWithProviders(<CookbookPage />, { route: '/cookbook' });
    expect(screen.getByRole('link', { name: 'Open Accounting' })).toBeInTheDocument();
    unmount();

    signedInAs([]);
    renderWithProviders(<CookbookPage />, { route: '/cookbook' });
    expect(screen.queryByRole('link', { name: 'Open Accounting' })).not.toBeInTheDocument();
    // The recipe itself stays: the reader still needs to know who releases it.
    expect(verifyRecipe()).toBeInTheDocument();
  });
});
