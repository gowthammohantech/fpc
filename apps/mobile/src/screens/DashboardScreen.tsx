import { RefreshControl, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { formatCompactINR } from '@fpc/shared';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ErrorMessage, Loading, Money, StatusBadge } from '../components/ui';
import { colors, styles } from '../lib/theme';
import type { RootStackParamList } from '../navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'Dashboard'>;

/**
 * The mobile dashboard is deliberately a summary, not a port of the desktop
 * screen: what a CFO needs from a phone is the shape of the position and a
 * way into the approvals waiting on them.
 */
export function DashboardScreen({ navigation }: Props) {
  const { user, logout } = useAuth();

  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.dashboard.summary(),
  });

  const { data: approvals } = useQuery({
    queryKey: ['approvals', 'mine', 'count'],
    queryFn: () => api.approvals.list({ scope: 'MINE', pageSize: 1 }),
  });

  if (isLoading) return <Loading />;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />}
    >
      {error ? <ErrorMessage error={error} /> : null}

      <View>
        <Text style={styles.muted}>Signed in as</Text>
        <Text style={styles.heading}>{user?.name}</Text>
      </View>

      <TouchableOpacity
        style={[styles.card, { backgroundColor: colors.brand, borderColor: colors.brand }]}
        onPress={() => navigation.navigate('Approvals')}
      >
        <Text style={{ color: '#dbeafe', fontSize: 13 }}>Waiting on you</Text>
        <Text style={{ color: '#ffffff', fontSize: 32, fontWeight: '700' }}>
          {approvals?.total ?? 0}
        </Text>
        <Text style={{ color: '#dbeafe', fontSize: 13 }}>
          {approvals?.total === 1 ? 'approval' : 'approvals'} · tap to review
        </Text>
      </TouchableOpacity>

      {data ? (
        <>
          <View style={styles.card}>
            <Text style={styles.muted}>Total payables</Text>
            <Money minor={data.totalPayables} />
            {data.payrollHidden ? (
              <Text style={styles.muted}>Excludes payroll — not visible to your role</Text>
            ) : null}
          </View>

          <View style={styles.card}>
            <Text style={styles.heading}>Invoices</Text>
            <Row label="Pending review" value={String(data.invoices.pendingReview)} />
            <Row
              label="Pending approval"
              value={`${data.invoices.pendingApproval} · ${formatCompactINR(data.invoices.pendingApprovalAmount)}`}
            />
            <Row
              label="Approved / unpaid"
              value={`${data.invoices.approvedUnpaid} · ${formatCompactINR(data.invoices.approvedUnpaidAmount)}`}
            />
            <Row
              label="Overdue"
              value={`${data.invoices.overdue} · ${formatCompactINR(data.invoices.overdueAmount)}`}
              tone={data.invoices.overdue > 0 ? colors.danger : undefined}
            />
          </View>

          {data.payroll ? (
            <TouchableOpacity
              style={styles.card}
              onPress={() => navigation.navigate('Payroll', { id: data.payroll!.batchId })}
            >
              <View style={styles.row}>
                <Text style={styles.heading}>{data.payroll.label}</Text>
                <StatusBadge status={data.payroll.status} />
              </View>
              <Money minor={data.payroll.amount} />
              <Text style={styles.muted}>
                {data.payroll.employeeCount.toLocaleString('en-IN')} employees
                {data.payroll.difference !== null
                  ? ` · ${data.payroll.difference >= 0 ? '+' : '−'}${formatCompactINR(Math.abs(data.payroll.difference))} vs last month`
                  : ''}
              </Text>
            </TouchableOpacity>
          ) : null}

          <View style={styles.card}>
            <Text style={styles.heading}>Payments</Text>
            <Row label="Ready to pay" value={formatCompactINR(data.payments.readyForPayment)} />
            <Row label="In flight" value={formatCompactINR(data.payments.batched)} />
            <Row
              label="Unreconciled"
              value={formatCompactINR(data.payments.unreconciled)}
              tone={data.payments.unreconciled > 0 ? colors.warning : undefined}
            />
          </View>

          <View style={styles.card}>
            <Text style={styles.heading}>Cash</Text>
            <Row label="Bank balance" value={formatCompactINR(data.cash.bankBalance)} />
            <Row
              label="Known upcoming outflow"
              value={formatCompactINR(data.cash.knownUpcomingOutflow)}
            />
          </View>
        </>
      ) : null}

      <TouchableOpacity style={{ paddingVertical: 16 }} onPress={() => void logout()}>
        <Text style={{ color: colors.danger, textAlign: 'center' }}>Sign out</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.muted}>{label}</Text>
      <Text style={[styles.body, { fontWeight: '600' }, tone ? { color: tone } : null]}>{value}</Text>
    </View>
  );
}
