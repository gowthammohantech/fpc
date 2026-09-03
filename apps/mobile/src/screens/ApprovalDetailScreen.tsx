import { useState } from 'react';
import { Alert, ScrollView, Text, TextInput, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { api } from '../lib/api';
import {
  Button,
  ErrorMessage,
  Loading,
  Money,
  StatusBadge,
  formatDate,
  humanize,
} from '../components/ui';
import { colors, styles } from '../lib/theme';
import type { RootStackParamList } from '../navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'ApprovalDetail'>;

/**
 * Approval detail with the full chain.
 *
 * The decision is confirmed with a native dialog before it is sent: on a
 * phone, an accidental tap would otherwise release real money.
 */
export function ApprovalDetailScreen({ route, navigation }: Props) {
  const { id } = route.params;
  const queryClient = useQueryClient();
  const [comment, setComment] = useState('');

  const {
    data: request,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['approval', id],
    queryFn: () => api.approvals.get(id),
  });

  const act = useMutation({
    mutationFn: (action: 'APPROVE' | 'REJECT') =>
      api.approvals.act(id, action, comment || undefined),
    onSuccess: (_result, action) => {
      void queryClient.invalidateQueries({ queryKey: ['approvals'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      Alert.alert(action === 'APPROVE' ? 'Approved' : 'Rejected', request?.subjectLabel, [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    },
  });

  const confirm = (action: 'APPROVE' | 'REJECT') => {
    Alert.alert(
      action === 'APPROVE' ? 'Approve this payment?' : 'Reject this item?',
      `${request?.subjectLabel}\n\nThis decision is recorded in the audit trail.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: action === 'APPROVE' ? 'Approve' : 'Reject',
          style: action === 'APPROVE' ? 'default' : 'destructive',
          onPress: () => act.mutate(action),
        },
      ],
    );
  };

  if (isLoading) return <Loading />;
  if (error) {
    return (
      <View style={styles.container}>
        <ErrorMessage error={error} />
      </View>
    );
  }
  if (!request) return null;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <View style={styles.card}>
        <Text style={styles.heading}>{request.subjectLabel}</Text>
        <Money minor={request.amount} />
        <View style={[styles.row, { justifyContent: 'flex-start', gap: 8 }]}>
          <StatusBadge status={request.status} />
          <Text style={styles.muted}>{humanize(request.subjectType)}</Text>
        </View>
        {request.ruleName ? <Text style={styles.muted}>Rule: {request.ruleName}</Text> : null}
        <Text style={styles.muted}>Submitted {formatDate(request.requestedAt)}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.heading}>Approval chain</Text>
        {request.steps.map((step) => (
          <View key={step.order} style={{ flexDirection: 'row', gap: 10, paddingVertical: 6 }}>
            <View
              style={{
                width: 26,
                height: 26,
                borderRadius: 13,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor:
                  step.status === 'APPROVED'
                    ? colors.successBg
                    : step.status === 'REJECTED'
                      ? colors.dangerBg
                      : step.status === 'ACTIVE'
                        ? colors.warningBg
                        : colors.border,
              }}
            >
              <Text style={{ fontSize: 12, fontWeight: '700', color: colors.text }}>
                {step.status === 'APPROVED' ? '✓' : step.status === 'REJECTED' ? '✕' : step.order}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.body}>{step.label}</Text>
              <Text style={styles.muted}>
                {step.status === 'ACTIVE'
                  ? 'Awaiting decision'
                  : step.actedByName
                    ? `${humanize(step.status)} by ${step.actedByName}`
                    : humanize(step.status)}
              </Text>
              {step.comment ? <Text style={styles.muted}>“{step.comment}”</Text> : null}
            </View>
          </View>
        ))}
      </View>

      {request.canAct ? (
        <View style={styles.card}>
          <Text style={styles.heading}>Your decision</Text>
          <TextInput
            style={[styles.input, { minHeight: 80, textAlignVertical: 'top' }]}
            multiline
            placeholder="Comment (optional)"
            value={comment}
            onChangeText={setComment}
          />
          <Button
            label={act.isPending ? 'Submitting…' : 'Approve'}
            onPress={() => confirm('APPROVE')}
            disabled={act.isPending}
          />
          <Button
            label="Reject"
            variant="danger"
            onPress={() => confirm('REJECT')}
            disabled={act.isPending}
          />
        </View>
      ) : request.status === 'IN_PROGRESS' ? (
        <View style={styles.card}>
          <Text style={styles.muted}>
            This is not currently waiting on you. You may be a later approver, or you submitted it —
            a submitter cannot approve their own item.
          </Text>
        </View>
      ) : null}

      {act.error ? <ErrorMessage error={act.error} /> : null}
    </ScrollView>
  );
}
