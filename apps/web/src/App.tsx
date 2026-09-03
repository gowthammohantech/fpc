import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { RequireAuth, RequirePermission } from '@/components/RequirePermission';
import { LoginPage } from '@/pages/Login';
import { AcceptInvitePage } from '@/pages/AcceptInvite';
import { DashboardPage } from '@/pages/Dashboard';
import { InvoicesPage } from '@/pages/Invoices';
import { InvoiceDetailPage } from '@/pages/InvoiceDetail';
import { ApprovalDetailPage, ApprovalsPage } from '@/pages/Approvals';
import { PayablesPage } from '@/pages/Payables';
import { PayrollDetailPage, PayrollImportPage, PayrollPage } from '@/pages/Payroll';
import { PaymentBatchDetailPage, PaymentBatchesPage, PaymentQueuePage } from '@/pages/Payments';
import { BankStatementsPage, BankTransactionsPage } from '@/pages/Banking';
import { ReconciliationPage } from '@/pages/Reconciliation';
import { ReportsPage } from '@/pages/Reports';
import { AuditPage } from '@/pages/Audit';
import { NotificationsPage } from '@/pages/Notifications';
import { AccountPage } from '@/pages/Account';
import {
  BankAccountsPage,
  CompaniesPage,
  DepartmentsPage,
  LocationsPage,
  RolesPage,
  UsersPage,
  VendorsPage,
} from '@/pages/settings';
import { ApprovalRulesPage } from '@/pages/settings/ApprovalRules';

/**
 * Routes mirror PRD §36 exactly. Each is wrapped in the permission its screen
 * needs, so a user who navigates directly to a URL sees a clear message rather
 * than a screen full of 403s.
 */
export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/accept-invite" element={<AcceptInvitePage />} />

      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="/dashboard" replace />} />

        <Route
          path="/dashboard"
          element={
            <RequirePermission permissions={['dashboard:read']}>
              <DashboardPage />
            </RequirePermission>
          }
        />

        <Route
          path="/invoices"
          element={
            <RequirePermission permissions={['invoice:read']}>
              <InvoicesPage />
            </RequirePermission>
          }
        />
        <Route
          path="/invoices/review"
          element={
            <RequirePermission permissions={['invoice:read']}>
              <InvoicesPage initialView="REVIEW" />
            </RequirePermission>
          }
        />
        <Route
          path="/invoices/:id"
          element={
            <RequirePermission permissions={['invoice:read']}>
              <InvoiceDetailPage />
            </RequirePermission>
          }
        />

        <Route
          path="/approvals"
          element={
            <RequirePermission permissions={['approval:read', 'approval:read_all']}>
              <ApprovalsPage />
            </RequirePermission>
          }
        />
        <Route
          path="/approvals/:id"
          element={
            <RequirePermission permissions={['approval:read', 'approval:read_all']}>
              <ApprovalDetailPage />
            </RequirePermission>
          }
        />

        <Route
          path="/payables"
          element={
            <RequirePermission permissions={['payable:read']}>
              <PayablesPage />
            </RequirePermission>
          }
        />

        <Route
          path="/payroll"
          element={
            <RequirePermission permissions={['payroll:read']}>
              <PayrollPage />
            </RequirePermission>
          }
        />
        <Route
          path="/payroll/import"
          element={
            <RequirePermission permissions={['payroll:create']}>
              <PayrollImportPage />
            </RequirePermission>
          }
        />
        <Route
          path="/payroll/:id"
          element={
            <RequirePermission permissions={['payroll:read']}>
              <PayrollDetailPage />
            </RequirePermission>
          }
        />

        <Route
          path="/payments"
          element={
            <RequirePermission permissions={['obligation:read']}>
              <PaymentQueuePage />
            </RequirePermission>
          }
        />
        <Route
          path="/payments/batches"
          element={
            <RequirePermission permissions={['payment_batch:read']}>
              <PaymentBatchesPage />
            </RequirePermission>
          }
        />
        <Route
          path="/payments/batches/:id"
          element={
            <RequirePermission permissions={['payment_batch:read']}>
              <PaymentBatchDetailPage />
            </RequirePermission>
          }
        />

        <Route
          path="/banking/statements"
          element={
            <RequirePermission permissions={['bank_statement:read']}>
              <BankStatementsPage />
            </RequirePermission>
          }
        />
        <Route
          path="/banking/transactions"
          element={
            <RequirePermission permissions={['bank_transaction:read']}>
              <BankTransactionsPage />
            </RequirePermission>
          }
        />

        <Route
          path="/reconciliation"
          element={
            <RequirePermission permissions={['reconciliation:read']}>
              <ReconciliationPage />
            </RequirePermission>
          }
        />

        <Route
          path="/reports"
          element={
            <RequirePermission permissions={['report:read']}>
              <ReportsPage />
            </RequirePermission>
          }
        />
        <Route
          path="/audit"
          element={
            <RequirePermission permissions={['audit:read']}>
              <AuditPage />
            </RequirePermission>
          }
        />
        <Route path="/account" element={<AccountPage />} />
        <Route
          path="/notifications"
          element={
            <RequirePermission permissions={['notification:read']}>
              <NotificationsPage />
            </RequirePermission>
          }
        />

        <Route
          path="/settings/companies"
          element={
            <RequirePermission permissions={['company:read']}>
              <CompaniesPage />
            </RequirePermission>
          }
        />
        <Route
          path="/settings/locations"
          element={
            <RequirePermission permissions={['location:read']}>
              <LocationsPage />
            </RequirePermission>
          }
        />
        <Route
          path="/settings/departments"
          element={
            <RequirePermission permissions={['department:read']}>
              <DepartmentsPage />
            </RequirePermission>
          }
        />
        <Route
          path="/settings/vendors"
          element={
            <RequirePermission permissions={['vendor:read']}>
              <VendorsPage />
            </RequirePermission>
          }
        />
        <Route
          path="/settings/users"
          element={
            <RequirePermission permissions={['user:read']}>
              <UsersPage />
            </RequirePermission>
          }
        />
        <Route
          path="/settings/roles"
          element={
            <RequirePermission permissions={['role:read']}>
              <RolesPage />
            </RequirePermission>
          }
        />
        <Route
          path="/settings/approvals"
          element={
            <RequirePermission permissions={['approval_rule:read']}>
              <ApprovalRulesPage />
            </RequirePermission>
          }
        />
        <Route
          path="/settings/bank-accounts"
          element={
            <RequirePermission permissions={['bank_account:read']}>
              <BankAccountsPage />
            </RequirePermission>
          }
        />

        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  );
}
