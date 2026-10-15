import { SEND_QUEUE_NAME, createSendQueue } from '@pcb/queue';
import { redis } from './redis.ts';

export { type SendJobPayload, SEND_QUEUE_NAME } from '@pcb/queue';

export const sendQueue = createSendQueue(redis);
