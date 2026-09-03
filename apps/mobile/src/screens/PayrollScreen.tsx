import { ScrollView, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { formatCompactINR } from '@fpc/shared';
import { api } from '../lib/api';
import { ErrorMessage, Loading, Money, StatusBadge } from '../components/ui';
import { colors, styles } from '../lib/theme';
import type { RootStackParamList } from '../navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'Payroll'>;

/**
 * Payroll approval view — PRD §19.
 *
 * Aggregates only. Individual salaries are never fetched or rendered on
 * mobile: the CFO approves a total, a headcount and a month-on-month
 * movement, which is exactly what the PRD's approval screen shows.
 */
export function PayrollScreen({ route }: Props) {
  const { id } = route.params;

  const {
    data: batch,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['payroll-batch', id],
    queryFn: () => api.payroll.get(id),
  });

  if (isLoading) return <Loading />;
  if (error) {
    return (
      <View style={styles.container}>
        <ErrorMessage error={error} />
      </View>
    );
  }
  if (!batch) return null;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.heading}>{batch.label}</Text>
          <StatusBadge status={batch.status} />
        </View>
        <Money minor={batch.totalNetAmount} />
        <Text style={styles.muted}>{batch.employeeCount.toLocaleString('en-IN')} employees</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.heading}>Compared with last month</Text>
        <View style={styles.row}>
          <Text style={styles.muted}>Previous</Text>
          <Text style={styles.body}>
            {batch.comparison.previousTotalNetAmount !== null
              ? formatCompactINR(batch.comparison.previousTotalNetAmount)
              : '—'}
          </Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.muted}>Difference</Text>
          <Text
            style={[
              styles.body,
              { fontWeight: '600' },
              batch.comparison.difference !== null
                ? { color: batch.comparison.difference >= 0 ? colors.warning : colors.success }
                : null,
            ]}
          >
            {batch.comparison.difference !== null
              ? `${batch.comparison.difference >= 0 ? '+' : '−'}${formatCompactINR(Math.abs(batch.comparison.difference))} (${batch.comparison.percentChange}%)`
              : '—'}
          </Text>
        </View>
      </View>

      {batch.locationBreakdown?.length ? (
        <View style={styles.card}>
          <Text style={styles.heading}>By location</Text>
          {batch.locationBreakdown.map((entry) => (
            <View key={entry.locationName} style={styles.row}>
              <Text style={styles.muted}>{entry.locationName}</Text>
              <Text style={styles.body}>
                {entry.count} · {formatCompactINR(entry.amount)}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      <Text style={[styles.muted, { textAlign: 'center' }]}>
        Individual salary details are available only on the web application.
      </Text>
    </ScrollView>
  );
}
