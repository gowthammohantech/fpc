import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { EmptyState, ErrorState, PageHeader, Spinner } from '@/components/ui';

/** In-app notifications — PRD §34. */
export function NotificationsPage() {
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.notifications.list({ pageSize: 50 }),
  });

  const markAllRead = useMutation({
    mutationFn: () => api.notifications.markAllRead(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const markRead = useMutation({
    mutationFn: (id: string) => api.notifications.markRead(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  return (
    <>
      <PageHeader
        title="Notifications"
        actions={
          <button
            className="btn-secondary"
            disabled={markAllRead.isPending}
            onClick={() => markAllRead.mutate()}
          >
            Mark all read
          </button>
        }
      />

      <div className="card">
        {isLoading ? (
          <Spinner />
        ) : error ? (
          <div className="p-4"><ErrorState error={error} /></div>
        ) : !data?.items.length ? (
          <EmptyState title="Nothing to catch up on" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.items.map((notification) => (
              <li
                key={notification.id}
                className={`px-5 py-4 ${notification.readAt ? '' : 'bg-brand-50/40'}`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-medium">{notification.title}</p>
                    <p className="mt-1 whitespace-pre-line text-sm text-slate-600">{notification.body}</p>
                    <p className="mt-1 text-xs text-slate-400">
                      {formatDateTime(notification.createdAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {notification.link ? (
                      <Link
                        className="btn-secondary"
                        to={notification.link}
                        onClick={() => markRead.mutate(notification.id)}
                      >
                        Open
                      </Link>
                    ) : null}
                    {!notification.readAt ? (
                      <button
                        className="text-xs text-slate-500 hover:text-slate-800"
                        onClick={() => markRead.mutate(notification.id)}
                      >
                        Mark read
                      </button>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
