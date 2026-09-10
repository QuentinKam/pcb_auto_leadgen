import { Queue } from 'bullmq';
import { redis } from './redis.ts';

export const SEND_QUEUE_NAME = 'pcb-mailer-sends';

export const sendQueue = new Queue(SEND_QUEUE_NAME, {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  },
});

export type SendJobPayload = {
  tenantId: string;
  emailSendId: string;
};
