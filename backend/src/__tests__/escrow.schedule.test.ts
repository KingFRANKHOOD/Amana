import request from 'supertest';
import express from 'express';
import { PrismaClient } from '@prisma/client';
import escrowScheduleRoutes from '../routes/escrow.schedule.routes';

const prisma = new PrismaClient();

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/escrow/schedule', escrowScheduleRoutes);
  return app;
}

describe('escrow schedule overwrite', () => {
  const app = buildApp();
  const tradeId = 'test-trade-1219';

  beforeEach(async () => {
    await prisma.escrowMilestone.deleteMany({ where: { tradeId } });
    await prisma.trade.upsert({
      where: { id: tradeId },
      update: { amount: 1000 },
      create: { id: tradeId, amount: 1000 },
    });
  });

  afterAll(async () => {
    await prisma.escrowMilestone.deleteMany({ where: { tradeId } });
    await prisma.trade.deleteMany({ where: { id: tradeId } });
    await prisma.$disconnect();
  });

  it('rejects duplicate milestoneIndex values', async () => {
    const res = await request(app)
      .put(`/api/escrow/schedule/${tradeId}`)
      .send({
        milestones: [
          { milestoneIndex: 0, amount: 500 },
          { milestoneIndex: 0, amount: 500 },
        ],
      });
    expect(res.status).toBe(400);
  });

  it('rejects zero and negative amounts', async () => {
    const res = await request(app)
      .put(`/api/escrow/schedule/${tradeId}`)
      .send({
        milestones: [
          { milestoneIndex: 0, amount: 0 },
          { milestoneIndex: 1, amount: 1000 },
        ],
      });
    expect(res.status).toBe(400);
  });

  it('rejects when milestone amounts do not sum to the trade amount', async () => {
    const res = await request(app)
      .put(`/api/escrow/schedule/${tradeId}`)
      .send({
        milestones: [
          { milestoneIndex: 0, amount: 400 },
          { milestoneIndex: 1, amount: 400 },
        ],
      });
    expect(res.status).toBe(400);
  });

  it('preserves the existing schedule when a mid-write failure occurs', async () => {
    await prisma.escrowMilestone.createMany({
      data: [
        { tradeId, milestoneIndex: 0, amount: 1000 },
      ],
    });

    const originalCreate = prisma.escrowMilestone.create;
    let calls = 0;
    // Simulate a failure partway through the create loop.
    (prisma.escrowMilestone as any).create = jest.fn((args: any) => {
      calls += 1;
      if (calls === 2) {
        throw new Error('simulated mid-write failure');
      }
      return originalCreate.call(prisma.escrowMilestone, args);
    });

    const res = await request(app)
      .put(`/api/escrow/schedule/${tradeId}`)
      .send({
        milestones: [
          { milestoneIndex: 0, amount: 500 },
          { milestoneIndex: 1, amount: 500 },
        ],
      });

    (prisma.escrowMilestone as any).create = originalCreate;

    expect(res.status).toBeGreaterThanOrEqual(500);

    const remaining = await prisma.escrowMilestone.findMany({
      where: { tradeId },
      orderBy: { milestoneIndex: 'asc' },
    });
    expect(remaining).toHaveLength(1);
    expect(remaining[0].amount).toBe(1000);
  });
});
