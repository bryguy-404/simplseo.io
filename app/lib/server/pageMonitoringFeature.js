import { ongoingReviewEnabled } from './ongoingReviewFeature';
import { isMonitoringCycle } from '../pageMonitoring';

export const pageMonitoringEnabled = uid => process.env.PAGE_MONITORING_ENABLED === 'true' && ongoingReviewEnabled(uid);
export const cycleCollectionEnabled = cycle => ongoingReviewEnabled(cycle?.userId)
  && (!isMonitoringCycle(cycle) || pageMonitoringEnabled(cycle.userId));
