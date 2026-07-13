import { ExpressAdapter } from '@bull-board/express';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { emailQueue } from '../jobs/email-queue.js';
import { logger } from '@workspace/logger';

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/queues');

createBullBoard({
  queues: [new BullMQAdapter(emailQueue)],
  serverAdapter,
});

const queueDashboardRouter = serverAdapter.getRouter();

// Wrap the router to log access (P2-T24: Monitoring View Accessed)
queueDashboardRouter.use((req, res, next) => {
  logger.info(
    {
      userId: req.user?.userId,
      path: req.path,
    },
    'Queue monitoring dashboard accessed',
  );
  next();
});

export { queueDashboardRouter };
