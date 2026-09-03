import { FlatList, RefreshControl, Text, TouchableOpacity, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Empty, ErrorMessage, Loading, formatDate } from '../components/ui';
import { colors, styles } from '../lib/theme';

export function NotificationsScreen() {
  const queryClient = useQueryClient();

  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.notifications.list({ pageSize: 50 }),
  });

  const markRead = useMutation({
    mutationFn: (id: string) => api.notifications.markRead(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
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
      ListEmptyComponent={<Empty title="Nothing to catch up on" />}
      renderItem={({ item }) => (
        <TouchableOpacity
          style={[
            styles.card,
            item.readAt ? null : { borderColor: colors.brand, backgroundColor: colors.brandLight },
          ]}
          onPress={() => !item.readAt && markRead.mutate(item.id)}
        >
          <Text style={styles.heading}>{item.title}</Text>
          <Text style={styles.body}>{item.body}</Text>
          <Text style={styles.muted}>{formatDate(item.createdAt)}</Text>
        </TouchableOpacity>
      )}
    />
  );
}
