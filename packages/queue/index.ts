/**
 * 共享队列契约（BullMQ + Redis）
 *
 * 生产端与消费端必须引用同一份队列名与 payload 类型，
 * 否则改名时只能靠全局搜索字符串常量，漏一处就是静默丢任务。
 * 这里只定义契约，Redis 连接实例由各服务自己注入。
 */
import { Queue } from 'bullmq';
import type Redis from 'ioredis';

/** 发送队列：mailer 路由入队，send-worker 消费 */
export const SEND_QUEUE_NAME = 'pcb-mailer-sends';

/** 域名 warmup 队列：warmup-worker 自带 cron，自己生产自己消费 */
export const WARMUP_QUEUE_NAME = 'pcb-mailer-warmup';

/** 任务只存引用，收件内容以 DB 记录为准，避免队列里堆大文本 */
export interface SendJobPayload {
  tenantId: string;
  emailSendId: string;
}

/** 统一的任务选项：3 次尝试 + 指数退避 */
export const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 5000 },
  removeOnComplete: 1000,
  removeOnFail: 5000,
};

export function createSendQueue(connection: Redis): Queue<SendJobPayload> {
  return new Queue<SendJobPayload>(SEND_QUEUE_NAME, {
    connection,
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });
}

export function createWarmupQueue(
  connection: Redis,
  overrides: Partial<typeof DEFAULT_JOB_OPTIONS> = {}
): Queue {
  return new Queue(WARMUP_QUEUE_NAME, {
    connection,
    defaultJobOptions: { ...DEFAULT_JOB_OPTIONS, ...overrides },
  });
}
