import { PrismaClient, DisputeStatus } from "@prisma/client";

export interface DisputeResponse {
  id: number;
  tradeId: string;
  initiator: string;
  reason: string;
  status: DisputeStatus;
  createdAt: string;
  updatedAt: string;
  trade: {
    buyerAddress: string;
    sellerAddress: string;
    amountUsdc: string;
  };
}

export interface DisputeListResponse {
  items: DisputeResponse[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export class DisputeService {
  constructor(private prisma: PrismaClient) {}

  async listMediatorDisputes(
    mediatorAddress: string,
    params: { status?: DisputeStatus; page?: number; limit?: number } = {}
  ): Promise<DisputeListResponse> {
    const { status, page = 1, limit = 10 } = params;
    const offset = (page - 1) * limit;

    // Check if address is a mediator (simplified check)
    const mediatorAddresses = (process.env.ADMIN_STELLAR_PUBKEYS ?? "").split(",").map(addr => addr.trim());
    if (!mediatorAddresses.includes(mediatorAddress)) {
      throw new Error("Unauthorized: Not a mediator");
    }

    const where = status ? { status } : { status: { in: [DisputeStatus.OPEN, DisputeStatus.UNDER_REVIEW] } };

    const [disputes, total] = await Promise.all([
      this.prisma.dispute.findMany({
        where,
        include: {
          trade: {
            select: {
              buyerAddress: true,
              sellerAddress: true,
              amountUsdc: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip: offset,
        take: limit,
      }),
      this.prisma.dispute.count({ where }),
    ]);

    return {
      items: disputes.map(dispute => ({
        id: dispute.id,
        tradeId: dispute.tradeId,
        initiator: dispute.initiator,
        reason: dispute.reason,
        status: dispute.status,
        createdAt: dispute.createdAt.toISOString(),
        updatedAt: dispute.updatedAt.toISOString(),
        trade: dispute.trade,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}