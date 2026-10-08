import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';

import { CommunicationLog, Contact, Customer, Project, Ticket, User } from '../../models';
import { CommunicationLogsController } from './communication-logs.controller';
import { CommunicationLogsService } from './communication-logs.service';
import { ContactsController } from './contacts.controller';
import { ContactsService } from './contacts.service';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';

@Module({
  imports: [
    SequelizeModule.forFeature([Customer, Contact, CommunicationLog, User, Project, Ticket]),
  ],
  controllers: [CustomersController, ContactsController, CommunicationLogsController],
  providers: [CustomersService, ContactsService, CommunicationLogsService],
  exports: [CustomersService],
})
export class CustomersModule {}
