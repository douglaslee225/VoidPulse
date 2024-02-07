import {
  ChartTimeRangeType,
  DataType,
  FilterAndOr,
  MetricMeasurement,
  PropOrigin,
} from "../app-router-type";
import { ClickHouseQueryResponse, clickhouse } from "../clickhouse";
import { __prod__ } from "../constants/prod";
import { filtersToSql } from "./filtersToSql";
import {
  InputMetric,
  MetricFilter,
} from "../routes/charts/insight/eventFilterSchema";
import { InsightData } from "../routes/charts/insight/getInsight";
import { getDateRange } from "./getDateRange";

type BreakdownData = {
  eventLabel: string;
  measurement: MetricMeasurement;
  breakdown?: any;
  average_count: number;
  data: [string, number][];
};

export const queryMetric = async ({
  projectId,
  from,
  to,
  metric,
  breakdowns,
  timeRangeType,
}: {
  projectId: string;
  from?: string;
  to?: string;
  timeRangeType: ChartTimeRangeType;
  breakdowns: MetricFilter[];
  metric: InputMetric;
}): Promise<BreakdownData[]> => {
  const { paramMap, whereStrings, paramCount } = filtersToSql(
    metric.filters.filter((x) => x.propOrigin === PropOrigin.event),
    1
  );
  const {
    paramMap: paramMap2,
    whereStrings: userWhereStrings,
    paramCount: paramCount2,
  } = filtersToSql(
    metric.filters.filter((x) => x.propOrigin === PropOrigin.user),
    paramCount
  );
  const whereCombiner = metric.andOr === FilterAndOr.or ? " OR " : " AND ";
  const query_params: any = {
    projectId,
    ...getDateRange(timeRangeType, from, to),
    eventName: metric.eventName,
    ...paramMap,
    ...paramMap2,
  };
  const joinSection =
    userWhereStrings.length ||
    (breakdowns.length && breakdowns[0].propOrigin === PropOrigin.user)
      ? `inner join people as p on e.distinct_id = p.distinct_id `
      : "";
  const whereSection = `
  project_id = {projectId:UUID}
    AND time >= {from:DateTime}
    AND time <= {to:DateTime}
    AND name = {eventName:String}
    ${whereStrings.length ? `AND ${whereStrings.join(whereCombiner)}` : ""}
    ${
      userWhereStrings.length
        ? `AND ${userWhereStrings.join(whereCombiner)}`
        : ""
    }
    `;
  let breakdownSelect = "";
  let breakdownBucketMinMaxQuery = "";
  let shouldBucketData = false;
  if (breakdowns.length) {
    const b = breakdowns[0];
    const jsonExtractor = {
      [DataType.string]: `JSONExtractString`,
      [DataType.number]: `JSONExtractFloat`,
      [DataType.boolean]: `JSONExtractBool`,
      [DataType.date]: `JSONExtractString`,
      [DataType.other]: ``,
    }[b.dataType];
    if (jsonExtractor) {
      query_params[`p${paramCount2 + 1}`] = b.propName;
      breakdownSelect = `${jsonExtractor}(${
        b.propOrigin === PropOrigin.user ? "p" : "e"
      }.properties, {p${paramCount2 + 1}:String})`;
    }
    if (b.dataType === DataType.number) {
      const query = `
      select count(distinct ${breakdownSelect}) > 10 as shouldBucket
      from events as e
      ${joinSection}
      where ${whereSection}`;
      if (!__prod__) {
        console.log(query);
      }
      const resp0 = await clickhouse.query({
        query,
        query_params,
      });
      const {
        data: [r0],
      } = await resp0.json<
        ClickHouseQueryResponse<{ shouldBucket: boolean }>
      >();
      if (r0 && r0.shouldBucket) {
        shouldBucketData = true;
        const numBuckets = 10;
        breakdownBucketMinMaxQuery = `, (SELECT
          min(${breakdownSelect}) AS min_breakdown,
          max(${breakdownSelect}) AS max_breakdown
          from events as e
          where ${whereSection}) as breakdown_min_max`;
        const bucket_idx = `widthBucket(${breakdownSelect}, min_breakdown, max_breakdown, ${numBuckets})`;
        const breakdownBucketSize = `(max_breakdown - min_breakdown) / ${numBuckets}`;
        const bucket_start = `min_breakdown + ${breakdownBucketSize} * (${bucket_idx} - 1)`;
        const bucket_end = `${bucket_start} + ${breakdownBucketSize}`;
        breakdownSelect = `
        (toString(${bucket_start}) || '-' || toString(${bucket_end})) as breakdown
        `;
      }
    }
  }
  if (breakdownSelect && !shouldBucketData) {
    breakdownSelect = `${breakdownSelect} as breakdown`;
  }
  let query = `
  SELECT
      toStartOfDay(time) AS day,
      toInt32(count(${
        metric.type === MetricMeasurement.totalEvents
          ? ``
          : `DISTINCT distinct_id`
      })) AS count
      ${breakdownSelect ? `, ${breakdownSelect}` : ""}
  FROM events as e${
    breakdownBucketMinMaxQuery ? `${breakdownBucketMinMaxQuery}` : ""
  }
  ${joinSection}
  WHERE ${whereSection}
  GROUP BY day${breakdownSelect ? ", breakdown" : ""}
  ORDER BY day ASC
`;
  if (breakdownSelect) {
    query = `
    select
    breakdown,
    avg(count) as average_count,
    groupArray((day, count)) as data
    from (${query})
    group by breakdown
    order by average_count desc
    limit 500
    `;
  }
  if (!__prod__) {
    console.log(query, paramMap, paramMap2);
  }
  const resp = await clickhouse.query({
    query,
    query_params,
  });
  const { data } = await resp.json<ClickHouseQueryResponse<InsightData>>();
  const eventLabel = `${metric.eventName} [${
    {
      [MetricMeasurement.totalEvents]: "Total events",
      [MetricMeasurement.uniqueUsers]: "Unique users",
    }[metric.type]
  }]`;

  if (breakdownSelect) {
    return (data as unknown as BreakdownData[]).map((x) => ({
      ...x,
      measurement: metric.type,
      eventLabel,
    }));
  } else {
    return [
      {
        eventLabel,
        measurement: metric.type,
        average_count: data.reduce((a, b) => a + b.count, 0) / data.length,
        data: data.map((x) => [x.day, x.count]),
      },
    ];
  }
};
