import { HttpError } from "../errors/httpError";
import { PrismaClient, TradeStatus } from "@prisma/client";
import { prisma as defaultPrisma } from "../lib/db";
import { ContractService } from "./contract.service";

export class TradeTemplateNotFoundError extends HttpError {
  status = 404;
  constructor() {
    super("Trade template not found");
    this.name = "TradeTemplateNotFoundError";
  }
}

export type TradeTemplateInput = {
  name: string;
  sellerAddress: string;
  amountUsdc: string;
  buyerLossBps: number;
  sellerLossBps: number;
};

type TemplateDatabase = Pick<PrismaClient, "tradeTemplate" | "trade">;

export class TradeTemplateService {
  constructor(
    private readonly prisma: TemplateDatabase = defaultPrisma,
    private readonly contractService = new ContractService(),
  ) {}

  async save(userAddress: string, input: TradeTemplateInput) {
    const normalizedUser = userAddress.toLowerCase();
    return this.prisma.tradeTemplate.upsert({
      where: {
        userAddress_name: { userAddress: normalizedUser, name: input.name },
      },
      create: {
        userAddress: normalizedUser,
        name: input.name,
        sellerAddress: input.sellerAddress.toLowerCase(),
        amountUsdc: input.amountUsdc,
        buyerLossBps: input.buyerLossBps,
        sellerLossBps: input.sellerLossBps,
      },
      update: {
        sellerAddress: input.sellerAddress.toLowerCase(),
        amountUsdc: input.amountUsdc,
        buyerLossBps: input.buyerLossBps,
        sellerLossBps: input.sellerLossBps,
      },
    });
  }

  async list(userAddress: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [templates, total] = await Promise.all([
      this.prisma.tradeTemplate.findMany({
        where: { userAddress: userAddress.toLowerCase() },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        skip,
        take: limit,
      }),
      this.prisma.tradeTemplate.count({
        where: { userAddress: userAddress.toLowerCase() },
      }),
    ]);
    return { templates, total, page, limit };
  }

  async createTradeFromTemplate(templateId: number, userAddress: string) {
    const buyerAddress = userAddress.toLowerCase();
    const template = await this.prisma.tradeTemplate.findFirst({
      where: { id: templateId, userAddress: buyerAddress },
    });
    if (!template) throw new TradeTemplateNotFoundError();

    const { tradeId, unsignedXdr } =
      await this.contractService.buildCreateTradeTx({
        buyerAddress,
        sellerAddress: template.sellerAddress,
        amountUsdc: template.amountUsdc,
        buyerLossBps: template.buyerLossBps,
        sellerLossBps: template.sellerLossBps,
      });
    await this.prisma.trade.create({
      data: {
        tradeId,
        buyerAddress,
        sellerAddress: template.sellerAddress,
        amountUsdc: template.amountUsdc,
        buyerLossBps: template.buyerLossBps,
        sellerLossBps: template.sellerLossBps,
        status: TradeStatus.PENDING_SIGNATURE,
      },
    });

    return { tradeId, unsignedXdr, templateId: template.id };
  }
}
