import { FlatList, RefreshControl, Text, TouchableOpacity, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { api } from '../lib/api';
import {
  Empty,
  ErrorMessage,
  Loading,
  Money,
  StatusBadge,
  formatDate,
  humanize,
} from '../components/ui';
import { styles } from '../lib/theme';
import type { RootStackParamList } from '../navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'Approvals'>;

/** The approvals inbox — the reason this app exists. */
export function ApprovalsScreen({ navigation }: Props) {
  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: ['approvals', 'mine'],
    queryFn: () => api.approvals.list({ scope: 'MINE', pageSize: 50 }),
  });

  if (isLoading) return <Loading />;
  if (error) {
    return (
      <View style={styles.container}>
        <ErrorMessage error={error} />
      </View>
    );
  }

  return (
    <FlatList
      style={styles.screen}
      contentContainerStyle={styles.container}
      data={data?.items ?? []}
      keyExtractor={(item) => item.id}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />}
      ListEmptyComponent={
        <Empty title="Nothing is waiting on you" hint="Approvals routed to you will appear here." />
      }
      renderItem={({ item }) => {
        const step = item.steps.find((entry) => entry.order === item.currentStepOrder);
        return (
          <TouchableOpacity
            style={styles.card}
            onPress={() => navigation.navigate('ApprovalDetail', { id: item.id })}
          >
            <View style={styles.row}>
              <Text style={[styles.heading, { flex: 1 }]} numberOfLines={2}>
                {item.subjectLabel}
              </Text>
              <StatusBadge status={item.status} />
            </View>
            <Money minor={item.amount} />
            <Text style={styles.muted}>
              {humanize(item.subjectType)} · {step?.label ?? '—'} · submitted{' '}
              {formatDate(item.requestedAt)}
            </Text>
          </TouchableOpacity>
        );
      }}
    />
  );
}
