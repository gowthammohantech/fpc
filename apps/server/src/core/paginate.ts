import type { FilterQuery, Model, PopulateOptions, SortOrder } from 'mongoose';
import type { Paginated } from '@fpc/shared';

export interface PaginateOptions {
  page: number;
  pageSize: number;
  sort?: string | undefined;
  order?: 'asc' | 'desc';
  defaultSort?: Record<string, SortOrder>;
  populate?: PopulateOptions | PopulateOptions[];
  projection?: Record<string, 0 | 1>;
}

/** Runs a count + page query and shapes the standard paginated envelope. */
export async function paginate<T>(
  model: Model<T>,
  filter: FilterQuery<T>,
  options: PaginateOptions,
  map: (doc: T) => unknown = (doc) => doc,
): Promise<Paginated<unknown>> {
  const { page, pageSize } = options;
  const sort: Record<string, SortOrder> = options.sort
    ? { [options.sort]: options.order === 'asc' ? 1 : -1 }
    : (options.defaultSort ?? { createdAt: -1 });

  let query = model
    .find(filter, options.projection)
    .sort(sort)
    .skip((page - 1) * pageSize)
    .limit(pageSize);
  if (options.populate) query = query.populate(options.populate as PopulateOptions);

  const [docs, total] = await Promise.all([
    query.lean<T[]>().exec(),
    model.countDocuments(filter).exec(),
  ]);

  return {
    items: docs.map(map),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}
