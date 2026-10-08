import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';

import { Customer, MaAddon, MaContract, MaPlan, MaPlanItem, MaUsage, Project } from '../../models';
import { MaContractExpiryScheduler } from './ma-contract-expiry.scheduler';
import { MaContractsController } from './ma-contracts.controller';
import { MaContractsService } from './ma-contracts.service';
import { MaPlansController } from './ma-plans.controller';
import { MaPlansService } from './ma-plans.service';
import { MaQuotaService } from './ma-quota.service';

@Module({
  imports: [
    SequelizeModule.forFeature([
      MaContract,
      MaPlan,
      MaPlanItem,
      MaAddon,
      MaUsage,
      Project,
      Customer,
    ]),
  ],
  controllers: [MaPlansController, MaContractsController],
  providers: [MaQuotaService, MaPlansService, MaContractsService, MaContractExpiryScheduler],
  exports: [MaQuotaService, MaContractsService],
})
export class MaModule {}
