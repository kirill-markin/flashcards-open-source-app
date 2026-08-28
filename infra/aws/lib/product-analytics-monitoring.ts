import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as apigw from "aws-cdk-lib/aws-apigateway";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as logs from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";

// The analytics ingest method is watched through the metrics API Gateway publishes for it, so
// nothing here depends on the shape of a log line. The resource path and the method must stay equal
// to the resource declared in infra/aws/lib/gateways/api-gateway.ts, whose stage method options keep
// metrics enabled for this method so the per-method dimensions are published at all.
const productAnalyticsIngestResourcePath: string = "/analytics/events";
const productAnalyticsIngestMethod: string = "POST";
const productAnalyticsAlarmPeriodMinutes = 5;
const productAnalyticsIngest5xxThreshold = 5;
// A saturated analytics pool answers 429 rather than 5xx, so this threshold is not a share of the
// route's traffic but the point at which batches are being refused systematically rather than one
// at a time. It is the only signal this route publishes for its own database capacity, and the
// per-method throttle is 20 rps, so anything tuned to the throttle instead would need a full outage
// at peak traffic before it fired.
const productAnalyticsIngestClientErrorThreshold = 25;
const productAnalyticsIngestClientErrorEvaluationPeriods = 2;
// Half of the 20 rps per-method throttle declared in infra/aws/lib/gateways/api-gateway.ts, summed
// over the alarm period. A batch carries up to 50 events, so this rate is already six figures of
// appended rows per period and is far above what product use explains at this stage.
const productAnalyticsIngestRequestVolumeThreshold = 3000;
const productAnalyticsIngestRequestVolumeEvaluationPeriods = 2;
// The two signals below are not published by any AWS service: they exist only inside the
// `analytics_events_ingest` record the route emits into the backend Lambda's log group, which is
// readable as `$.message.<field>` because every backend Lambda now emits its records as objects
// under JSON logging format (see infra/aws/lib/backend-lambda-logging.ts). Both count events rather
// than requests, because a batch carries up to 50 of them and one request can therefore be entirely
// bad or entirely fine.
const productAnalyticsIngestAction: string = "analytics_events_ingest";
const productAnalyticsLogDerivedMetricNamespace: string = "FlashcardsOpenSourceApp/ProductAnalytics";
const productAnalyticsContractRejectedMetricName: string = "ContractRejectedEvents";
const productAnalyticsOutOfWindowMetricName: string = "OccurredAtOutOfWindowEvents";
// Half a full batch of events refused as off contract, in each of the two consecutive periods
// declared below. Absolute rather than a share of traffic, as the three native alarms above are:
// this product's volume is low enough that a ratio would be noise. A contract rejection has no
// benign cause - a shipped client is built against the event catalog, and nothing this backend does
// on its own produces one - which is why it can sit far below the out-of-window threshold without
// becoming noisy, and why a single device draining an off-contract backlog across both periods is a
// true positive rather than something to suppress.
//
// Two different things reach it, though, and the alarm cannot tell them apart on its own. One is a
// client build off contract. The other is a caller sending events this backend refuses: the route
// is public and human-authenticated, it accepts guest sessions, and the repository is open source,
// so 25 refused events per period is well within reach of one person posting malformed batches by
// hand - the same actor the request-volume alarm above calls an abusive caller. What separates them
// is `platform` and `appVersion` on the `analytics_contract_violation` capture named below: a bad
// release is one version across many installs, a hand-rolled caller is usually neither.
//
// What it detects: enough refused events at once, from either of those. What it does not detect: a
// broken build on a low-traffic surface in a quiet hour. At roughly one to three events per active
// user per minute - a repo-local estimate of what this coarse catalog generates, not a figure the
// client contract publishes - 25 per period twice over needs several users at once on the broken
// build, and a launch-day client at 3am can stay under it indefinitely.
//
// What covers that gap is not this alarm and not the client's own accounting: it is the route's
// Sentry capture of contract violations (`captureContractViolations` in
// apps/backend/src/routes/productAnalytics.ts, emitted as `analytics_contract_violation`). It opens
// one issue per fingerprint rather than per volume, so one install on a broken build is enough, and
// it is the only place the `event_id_not_uuid_v7` violation is visible at all - the client is told a
// generic `invalid_event`. Do not remove it on the strength of this alarm.
//
// The client's own `analytics_events_dropped` count with `reason: "rejected"` is a secondary signal
// beside it, with a blind spot exactly where it would matter most: a defect in the shape of every
// event a client sends - a v4 event id, or a timestamp written without a `Z` - also breaks that drop
// event, which is refused for the same reason and never lands in `product_events`. A moved clock is
// the one case where it does survive, because the drop event is created at flush time and carries a
// current timestamp.
const productAnalyticsContractRejectedThreshold = 25;
// Two *consecutive* periods, deliberately: `datapointsToAlarm` is set equal to this below, and
// M-out-of-N with M = N is exactly the consecutive case. Unlike the out-of-window alarm further
// down, nothing here needs a quiet-side guarantee to hold, so the only job of the second period is
// the same one it does for the three native alarms above - keep one spike from paging - and this
// alarm stays in step with them rather than drifting to a looser M-of-N shape.
const productAnalyticsContractRejectedEvaluationPeriods = 2;
// Unlike the contract signal this one has a benign cause: a device whose clock moves backwards
// between recording an event and flushing it rejects everything it had queued at once, with nothing
// actually wrong. So the alarm has to be unreachable by one device and still reachable by a
// population. The lever for that is how many breaching periods are required, not the height of the
// threshold, because a device and a population differ in duration, not in rate: one device's
// supply of these rejections is finite - it is whatever it had queued when its clock moved, and a
// 200 purges the whole batch whether the events were stored or refused, so the same events cannot
// be presented twice - while a defect that makes a build compute impossible timestamps keeps
// producing them for as long as that build is live.
//
// The lever is `datapointsToAlarm` (M), and the guarantee is M * T > C. CloudWatch's own definition
// is what makes that the right arithmetic and not the consecutiveness of the periods: "Datapoints to
// Alarm is the number of data points within the Evaluation Periods that must be breaching to cause
// the alarm to go to the ALARM state. The breaching data points don't have to be consecutive, but
// they must all be within the last number of data points equal to Evaluation Period."
// (https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/alarm-evaluation.html; the same
// M-out-of-N reading of the two parameters is in the PutMetricAlarm API reference.) So a device that
// can hold at most C events cannot place T of them in M separate periods once M * T > C, whatever
// pacing it drains at and wherever in the window those periods fall. M * T is 12 * 500 = 6000,
// clearing C with 1000 events of headroom, which also absorbs whatever the device generates fresh
// over the window those periods sit in.
//
// C is 5000, the per-device client queue cap. It is a binding cross-client constant, not a
// suggestion: the shared client wire contract declares it and the web, iOS and Android client plans
// each carry it verbatim, so all three shipped clients are required to implement that exact cap. It
// is also the one per-device bound the contract publishes - there is no per-device event rate in it,
// and none is assumed here. A client that ships a different queue cap is therefore changing this
// alarm's guarantee, and redoing M * T > C is part of that change.
//
// N is larger than M on purpose. Requiring all M periods to be consecutive would not tighten the
// quiet side at all - the arithmetic above never used consecutiveness - and it costs the firing
// side dearly: at the very population this is meant to catch, arrivals are batches rather than a
// smooth rate, so periods scatter either side of their mean and a single sub-threshold period would
// reset the streak and hold the alarm silent through a real incident. Twelve of the last fifteen
// tolerates three such periods per window.
//
// It stays reachable: 500 events per period is 10 full 50-event batches, roughly 0.03 requests per
// second, orders of magnitude under the 3000-request volume alarm above. At the one-to-three events
// per active user per minute noted on the contract threshold above - the same repo-local estimate,
// used here only for reachability and not for the guarantee - that is on the order of 35 to 100
// installs simultaneously active on a build whose events are all refused. Below that the loss is
// invisible here and visible in the data, as it is for the contract signal.
//
// An hour of breaching data inside a 75-minute window - twelve of fifteen periods at the five
// minutes these alarms share - is deliberate latency. Both causes this can see, a clock that moved
// or a claimed interval longer than the thirty-day server window, are worth knowing as a rate and
// are not worth paging on quickly. The guarantee rests on M and T alone and not on N or on how long
// a period is: lowering either of M and T puts one device back within reach of this alarm. Redo
// M * T > 5000 before changing either, and redo it if the client queue cap ever changes. N may be
// raised on its own to tolerate more quiet periods, and must never be lowered below M.
const productAnalyticsOutOfWindowThreshold = 500;
const productAnalyticsOutOfWindowDatapointsToAlarm = 12;
const productAnalyticsOutOfWindowEvaluationPeriods = 15;
// Both log-derived alarms below state their comparison operator explicitly. `cloudwatch.Alarm`
// defaults it to GREATER_THAN_OR_EQUAL_TO_THRESHOLD, which is what these want, but the thresholds
// above are reasoned about as "this many events breaches" and that reasoning should be readable at
// the call site rather than depend on a library default that a dependency bump could move.
const productAnalyticsLogDerivedComparisonOperator: cloudwatch.ComparisonOperator =
  cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD;

interface ProductAnalyticsMonitoringProps {
  restApi: apigw.RestApi;
  backendFn: lambda.Function;
  notifyAlert: (alarm: cloudwatch.Alarm) => void;
}

// Both analytics counts are carried by the same successful-ingest record, so one pattern selects it
// and each filter reads a different field off it as its metric value. The failure record
// (`analytics_events_ingest_error`) is deliberately not selected: its batch was never stored, the
// client retries it, and counting it would report the same rejections again on every retry.
function createProductAnalyticsIngestRecordFilterPattern(): logs.IFilterPattern {
  return logs.FilterPattern.stringValue(
    "$.message.action",
    "=",
    productAnalyticsIngestAction,
  );
}

// API Gateway publishes Count, 4XXError and 5XXError per method once the stage keeps metrics
// enabled for it, so the analytics ingest alarms read metrics the service emits on its own instead
// of anything derived from a log line.
function createProductAnalyticsIngestMetric(
  restApi: apigw.RestApi,
  metricName: string,
): cloudwatch.Metric {
  return new cloudwatch.Metric({
    namespace: "AWS/ApiGateway",
    metricName,
    dimensionsMap: {
      ApiName: restApi.restApiName,
      Stage: restApi.deploymentStage.stageName,
      Resource: productAnalyticsIngestResourcePath,
      Method: productAnalyticsIngestMethod,
    },
    period: cdk.Duration.minutes(productAnalyticsAlarmPeriodMinutes),
    statistic: "Sum",
  });
}

export function addProductAnalyticsMonitoring(
  scope: Construct,
  props: ProductAnalyticsMonitoringProps,
): void {
  // What reaches this metric is the database being unreachable, which the writer answers with 503,
  // and a defect. A saturated or slow-connecting database is refused with 429 by the analytics
  // writer instead and is watched by the client-error alarm below, so a low count here already means
  // something no retry from the client's queue is going to fix.
  props.notifyAlert(new cloudwatch.Alarm(scope, "ProductAnalyticsIngest5xxAlarm", {
    metric: createProductAnalyticsIngestMetric(props.restApi, "5XXError"),
    threshold: productAnalyticsIngest5xxThreshold,
    evaluationPeriods: 1,
    alarmDescription:
      `Product analytics ingest answered ${productAnalyticsIngest5xxThreshold}+ requests with a 5xx in ` +
      `${productAnalyticsAlarmPeriodMinutes} minutes, so the analytics database is unreachable for this route ` +
      "or the route itself is failing",
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  }));

  // A REST API publishes no throttle-only metric, so a throttled request is counted inside the
  // method's 4XXError along with the auth rejections. Everything that protects this route answers
  // 429 here: the per-method stage throttle, the analytics writer's pool cap, and a pool acquisition
  // that times out because the database is saturated or connecting slowly. That last one is why the
  // threshold is low: this is where a database-capacity incident on this route now surfaces, and the
  // 5xx alarm above no longer sees it. A contract violation answers 200 with per-event results and
  // never reaches this metric, so a sustained 4xx rate on this method means batches are being
  // refused rather than adjudicated. Two consecutive periods keep a client release rolling out
  // behind an expired token from paging on one spike, and a capacity incident is sustained.
  props.notifyAlert(new cloudwatch.Alarm(scope, "ProductAnalyticsIngestClientErrorAlarm", {
    metric: createProductAnalyticsIngestMetric(props.restApi, "4XXError"),
    threshold: productAnalyticsIngestClientErrorThreshold,
    evaluationPeriods: productAnalyticsIngestClientErrorEvaluationPeriods,
    datapointsToAlarm: productAnalyticsIngestClientErrorEvaluationPeriods,
    alarmDescription:
      `Product analytics ingest refused ${productAnalyticsIngestClientErrorThreshold}+ requests with a 4xx per ` +
      `${productAnalyticsAlarmPeriodMinutes} minutes for two consecutive periods, so the method throttle, the ` +
      "analytics writer pool, a database too saturated to hand out a connection, or client authentication is " +
      "rejecting whole batches",
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  }));

  // An accepted batch answers 200, so a broken client stuck in a redelivery loop or an abusive
  // caller touches neither 4XXError nor 5XXError and shows up only as append-only row growth and a
  // bill. This route ships no per-identity rate limiting by design, which makes this static
  // high-water mark the compensating control for that decision. Two consecutive periods keep a
  // queue flush after an outage, which is exactly the traffic the offline-first clients are built
  // to produce, from paging on a single period.
  props.notifyAlert(new cloudwatch.Alarm(scope, "ProductAnalyticsIngestRequestVolumeAlarm", {
    metric: createProductAnalyticsIngestMetric(props.restApi, "Count"),
    threshold: productAnalyticsIngestRequestVolumeThreshold,
    evaluationPeriods: productAnalyticsIngestRequestVolumeEvaluationPeriods,
    datapointsToAlarm: productAnalyticsIngestRequestVolumeEvaluationPeriods,
    alarmDescription:
      `Product analytics ingest took ${productAnalyticsIngestRequestVolumeThreshold}+ requests per ` +
      `${productAnalyticsAlarmPeriodMinutes} minutes for two consecutive periods, so batches are arriving far ` +
      "faster than product use explains and analytics rows are growing unwatched",
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  }));

  // The backend Lambda's own log group, where the ingest record lands. It is reached through the
  // `.logGroup` getter, the same way the direct-image-ingestion and multipart-reconciliation filters
  // in monitoring.ts reach theirs, and not through `logs.LogGroup.fromLogGroupName`, which an
  // earlier draft of this block used. Importing by name renders the filter's LogGroupName as
  // `/aws/lambda/` joined to a Ref on the function, which orders the filter after the *function* but
  // not after the *group*: Lambda only creates that group on the function's first invocation, so on
  // a stack deployed from scratch - a fork, or `scripts/deploy/bootstrap.sh` - CloudFormation can
  // create the metric filters before the group exists and roll the whole stack back. The getter
  // instead renders LogGroupName as an `Fn::GetAtt` on a `Custom::LogRetention` resource whose
  // handler creates the group when it is missing and tolerates it when it is not, which is exactly
  // the ordering dependency the filters need.
  //
  // That custom resource is the thing this monitoring policy previously avoided, on the grounds
  // that it would pin the group's retention. It does not, in this case: the getter asks for
  // RetentionDays.INFINITE, which renders with no RetentionInDays at all, meaning "never expire" -
  // and a read-only check of the live group returned exactly that, no finite retention. So the live
  // group is left as it is. The stack also already carries this custom resource for
  // `directImageIngestionFn` and `multipartCompletionReconciliationFn`, and its provider Lambda is a
  // singleton, so this reuses what is there rather than introducing the pattern.
  //
  // Ownership moves with it, though, and that is the part to know before touching this group: from
  // here on the stack declares the backend API group's retention, and what it declares is
  // never-expire. That declaration is not re-asserted on every deploy. CloudFormation sends a custom
  // resource an Update only when that resource's own properties change, and these - the group name
  // and the absent RetentionInDays - are stable, so an ordinary deploy of `main` leaves this
  // resource alone. A finite retention set on the group by hand, in the console to cut log cost,
  // therefore keeps working while diverging from what the stack says, and is reverted only whenever
  // this resource next changes, silently, because the handler issues DeleteRetentionPolicy rather
  // than reading what is there. The delay makes a console change worse rather than safer: it holds,
  // and then one deploy it does not. Retention on this group is changed by giving the function an
  // explicit retention where it is defined, in infra/aws/lib/gateways/api-gateway.ts, never from the
  // console. This is stated for operators in docs/agent-sql-telemetry.md as well, which is where
  // someone reading these records would look.
  const backendLogGroup = props.backendFn.logGroup;

  // `contractRejectedCount` is emitted by the route as `rejectedCount` minus `outOfWindowCount`
  // rather than being derived here. A metric filter cannot subtract one field from another, and the
  // alternative - two filter metrics differenced by a MathExpression - would make this alarm depend
  // on how two independently published metrics line up in a period. The subtraction has to happen
  // somewhere, and the only place that knows the two counts describe the same batch is the route.
  const productAnalyticsContractRejectedMetricFilter = new logs.MetricFilter(
    scope,
    "ProductAnalyticsContractRejectedMetricFilter",
    {
      logGroup: backendLogGroup,
      filterPattern: createProductAnalyticsIngestRecordFilterPattern(),
      metricNamespace: productAnalyticsLogDerivedMetricNamespace,
      metricName: productAnalyticsContractRejectedMetricName,
      metricValue: "$.message.contractRejectedCount",
      defaultValue: 0,
    },
  );

  // A contract rejection answers 200 with per-event results, so it touches neither the 4xx nor the
  // 5xx alarm above: nothing else in this stack can see a client release sending events this backend
  // refuses. Out-of-window rejections are excluded from this count on purpose - they mean a device
  // clock, not a client off contract, and they have their own alarm below.
  props.notifyAlert(new cloudwatch.Alarm(scope, "ProductAnalyticsContractRejectionAlarm", {
    metric: productAnalyticsContractRejectedMetricFilter.metric({
      period: cdk.Duration.minutes(productAnalyticsAlarmPeriodMinutes),
      statistic: "Sum",
    }),
    threshold: productAnalyticsContractRejectedThreshold,
    comparisonOperator: productAnalyticsLogDerivedComparisonOperator,
    evaluationPeriods: productAnalyticsContractRejectedEvaluationPeriods,
    datapointsToAlarm: productAnalyticsContractRejectedEvaluationPeriods,
    alarmDescription:
      `Product analytics ingest refused ${productAnalyticsContractRejectedThreshold}+ events as off contract in ` +
      `each of ${productAnalyticsContractRejectedEvaluationPeriods} consecutive ` +
      `${productAnalyticsAlarmPeriodMinutes}-minute periods. Either a shipped client build is off contract ` +
      "and its analytics are being dropped, or a caller is sending events this backend refuses - the route is " +
      "public, human-authenticated, accepts guest sessions, and is open source, so a hand-posted batch reaches " +
      "this too. One device draining an off-contract backlog can also reach it and is a true positive. Sentry " +
      "`analytics_contract_violation` names the exact violation, including the non-v7 event id the client is " +
      "never told about, and its `platform`/`appVersion` is what separates a bad release from a caller",
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  }));

  const productAnalyticsOutOfWindowMetricFilter = new logs.MetricFilter(
    scope,
    "ProductAnalyticsOutOfWindowMetricFilter",
    {
      logGroup: backendLogGroup,
      filterPattern: createProductAnalyticsIngestRecordFilterPattern(),
      metricNamespace: productAnalyticsLogDerivedMetricNamespace,
      metricName: productAnalyticsOutOfWindowMetricName,
      metricValue: "$.message.outOfWindowCount",
      defaultValue: 0,
    },
  );

  // Routed to an alarm instead of Sentry on purpose: this is a clock, not a broken contract, and it
  // is not actionable one event at a time. Validation trusts only the device-local interval between
  // recording and sending and anchors it to the server clock, so a device whose clock is simply
  // wrong is corrected silently and never lands here. What does land here is an interval that
  // cannot be true: the clock moved between the two readings, or the interval claims a wait longer
  // than the thirty-day window, which the client's own 14-day queue TTL means it cannot actually
  // have served. Both are worth knowing about as a rate and neither is worth opening an issue for.
  // Neither implies a genuine device, either: the correction is defeated by any `clientOccurredAt`
  // later than the `clientSentAt` beside it, which is one line for anyone posting to this public
  // route by hand, and that is why the description below names a deliberate caller beside a build.
  props.notifyAlert(new cloudwatch.Alarm(scope, "ProductAnalyticsOccurredAtOutOfWindowAlarm", {
    metric: productAnalyticsOutOfWindowMetricFilter.metric({
      period: cdk.Duration.minutes(productAnalyticsAlarmPeriodMinutes),
      statistic: "Sum",
    }),
    threshold: productAnalyticsOutOfWindowThreshold,
    comparisonOperator: productAnalyticsLogDerivedComparisonOperator,
    evaluationPeriods: productAnalyticsOutOfWindowEvaluationPeriods,
    datapointsToAlarm: productAnalyticsOutOfWindowDatapointsToAlarm,
    alarmDescription:
      `Product analytics ingest refused ${productAnalyticsOutOfWindowThreshold}+ events for an impossible ` +
      `occurred_at in ${productAnalyticsOutOfWindowDatapointsToAlarm} of the last ` +
      `${productAnalyticsOutOfWindowEvaluationPeriods} ${productAnalyticsAlarmPeriodMinutes}-minute periods - ` +
      `${productAnalyticsOutOfWindowDatapointsToAlarm * productAnalyticsOutOfWindowThreshold} events inside a ` +
      `${productAnalyticsOutOfWindowEvaluationPeriods * productAnalyticsAlarmPeriodMinutes}-minute window, more ` +
      "than the 5000-event queue one device is allowed to hold, so one device draining what it queued while its " +
      "clock moved cannot reach this on its own. What can: a build or a population computing timestamps wrong, " +
      "or a caller posting them deliberately - the route is public, human-authenticated, accepts guest sessions, " +
      "and is open source, and any clientOccurredAt after the clientSentAt beside it is refused this way. Check " +
      "whether the rejections share one app version - a bad release is one version across many installs, a " +
      "caller usually neither - before looking at anything else",
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  }));
}
