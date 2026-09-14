import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { Op, type Transaction, type WhereOptions } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';

import { type PaginatedResult, toPaginatedResult } from '../../common/dto/pagination.dto';
import { nextSequenceNumber } from '../../common/utils/code-sequence.util';
import {
  CommunicationLog,
  Contact,
  Customer,
  CustomerStatus,
  Project,
  Ticket,
  User,
  UserStatus,
} from '../../models';
import { CreateCustomerDto, UpdateCustomerDto } from './dto/create-customer.dto';
import { type CustomerResponseDto, toCustomerResponse } from './dto/customer.response';
import { QueryCustomersDto } from './dto/query-customers.dto';

/** ฟิลด์ที่ยอมให้เรียงลำดับได้ — กันค่าแปลกปลอมจาก query string sortBy หลุดเข้า ORDER BY */
const SORTABLE_FIELDS = new Set([
  'id',
  'code',
  'name',
  'status',
  'province',
  'lastContactedAt',
  'createdAt',
  'updatedAt',
]);

const OWNER_INCLUDE = {
  model: User,
  as: 'owner',
  attributes: ['id', 'username', 'fullName'],
  required: false,
  // ยังต้องเห็นชื่อผู้ดูแลแม้พนักงานคนนั้นลาออกและถูก soft delete ไปแล้ว
  paranoid: false,
};

const CONTACTS_INCLUDE = {
  model: Contact,
  attributes: [
    'id',
    'customerId',
    'name',
    'nickname',
    'position',
    'phone',
    'email',
    'lineId',
    'isPrimary',
    'note',
    'createdAt',
    'updatedAt',
  ],
  required: false,
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

@Injectable()
export class CustomersService {
  constructor(
    @InjectModel(Customer) private readonly customerModel: typeof Customer,
    @InjectModel(Contact) private readonly contactModel: typeof Contact,
    @InjectModel(CommunicationLog) private readonly logModel: typeof CommunicationLog,
    @InjectModel(Project) private readonly projectModel: typeof Project,
    @InjectModel(Ticket) private readonly ticketModel: typeof Ticket,
    @InjectModel(User) private readonly userModel: typeof User,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  async findAll(query: QueryCustomersDto): Promise<PaginatedResult<CustomerResponseDto>> {
    const where: WhereOptions<Customer> = {};

    if (query.search) {
      const like = '%' + query.search + '%';
      Object.assign(where, {
        [Op.or]: [
          { name: { [Op.like]: like } },
          { code: { [Op.like]: like } },
          { taxId: { [Op.like]: like } },
          { phone: { [Op.like]: like } },
          { email: { [Op.like]: like } },
        ],
      });
    }

    if (query.status) {
      Object.assign(where, { status: query.status });
    }

    if (query.ownerUserId !== undefined) {
      Object.assign(where, { ownerUserId: query.ownerUserId });
    }

    if (query.businessType) {
      Object.assign(where, { businessType: query.businessType });
    }

    if (query.province) {
      Object.assign(where, { province: query.province });
    }

    // หน้าจอ "ลูกค้าที่ถูกลืม" — ตอบ pain point ที่ผู้บริหารบ่นว่าลืมติดตามลูกค้า
    // จนเลยไปเป็นเดือนสองเดือน คนที่ยังไม่เคยติดต่อเลยต้องติดมาด้วย ไม่ใช่หลุดออกไป
    if (query.idleDays !== undefined) {
      const threshold = new Date(Date.now() - query.idleDays * MS_PER_DAY);
      Object.assign(where, {
        [Op.and]: [
          { [Op.or]: [{ lastContactedAt: null }, { lastContactedAt: { [Op.lt]: threshold } }] },
        ],
      });
    }

    const sortBy = SORTABLE_FIELDS.has(query.sortBy ?? '') ? (query.sortBy as string) : 'createdAt';

    const { rows, count } = await this.customerModel.findAndCountAll({
      where,
      include: [OWNER_INCLUDE],
      distinct: true,
      order: [[sortBy, query.sortOrder]],
      limit: query.limit,
      offset: query.offset,
    });

    return toPaginatedResult(rows.map(toCustomerResponse), count, query);
  }

  async findOne(id: number): Promise<CustomerResponseDto> {
    const customer = await this.customerModel.findByPk(id, {
      include: [
        OWNER_INCLUDE,
        // เรียงผู้ติดต่อหลักขึ้นก่อนเสมอ หน้าจอจะได้ไม่ต้องเรียงเอง
        {
          ...CONTACTS_INCLUDE,
          separate: true,
          order: [
            ['isPrimary', 'DESC'],
            ['name', 'ASC'],
          ],
        },
      ],
    });

    if (!customer) {
      throw new NotFoundException('ไม่พบข้อมูลลูกค้า');
    }

    return toCustomerResponse(customer);
  }

  async create(dto: CreateCustomerDto, actorId: number): Promise<CustomerResponseDto> {
    const customer = await this.sequelize.transaction((transaction) =>
      this.createRecord(dto, actorId, transaction),
    );

    return this.findOne(customer.id);
  }

  /**
   * สร้างแถวลูกค้า — กติกาการสร้างลูกค้าอยู่ที่นี่ที่เดียว
   *
   * ใช้ทั้ง `POST /api/customers` และตอนสร้างโครงการพร้อมลูกค้าใหม่ในฟอร์มเดียว
   * (ประชุม 11 ก.ย. — B-3) ซึ่งส่ง transaction มา เพื่อให้ลูกค้ากับโครงการถูกบันทึก
   * พร้อมกันหรือไม่ถูกบันทึกเลย ไม่เหลือลูกค้าลอยอยู่เมื่อการสร้างโครงการพัง
   */
  async createRecord(
    dto: CreateCustomerDto,
    actorId: number | null,
    transaction: Transaction,
  ): Promise<Customer> {
    if (dto.ownerUserId) {
      await this.assertOwnerExists(dto.ownerUserId);
    }

    const code = `CUS-${String(await nextSequenceNumber(this.sequelize, 'CUSTOMER', transaction)).padStart(3, '0')}`;

    return this.customerModel.create(
      {
        name: dto.name,
        code,
        taxId: dto.taxId ?? null,
        businessType: dto.businessType ?? null,
        address: dto.address ?? null,
        province: dto.province ?? null,
        postalCode: dto.postalCode ?? null,
        phone: dto.phone ?? null,
        email: dto.email ?? null,
        website: dto.website ?? null,
        lineOfficialId: dto.lineOfficialId ?? null,
        facebookUrl: dto.facebookUrl ?? null,
        // ไม่ส่งมา = ลูกค้าปัจจุบัน เพราะบันทึกเฉพาะลูกค้าที่ใช้บริการจริงแล้ว (ไม่มีผู้มุ่งหวัง)
        // เขียนไว้ที่นี่ด้วยแทนที่จะพึ่ง default ของคอลัมน์อย่างเดียว กติกาจะได้อ่านเจอในโค้ด
        status: dto.status ?? CustomerStatus.ACTIVE,
        source: dto.source ?? null,
        ownerUserId: dto.ownerUserId ?? null,
        note: dto.note ?? null,
        createdBy: actorId,
        updatedBy: actorId,
      },
      { transaction },
    );
  }

  async update(id: number, dto: UpdateCustomerDto, actorId: number): Promise<CustomerResponseDto> {
    const customer = await this.findOrFail(id);

    if (dto.ownerUserId) {
      await this.assertOwnerExists(dto.ownerUserId);
    }

    await customer.update({
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.taxId !== undefined ? { taxId: dto.taxId ?? null } : {}),
      ...(dto.businessType !== undefined ? { businessType: dto.businessType ?? null } : {}),
      ...(dto.address !== undefined ? { address: dto.address ?? null } : {}),
      ...(dto.province !== undefined ? { province: dto.province ?? null } : {}),
      ...(dto.postalCode !== undefined ? { postalCode: dto.postalCode ?? null } : {}),
      ...(dto.phone !== undefined ? { phone: dto.phone ?? null } : {}),
      ...(dto.email !== undefined ? { email: dto.email ?? null } : {}),
      ...(dto.website !== undefined ? { website: dto.website ?? null } : {}),
      ...(dto.lineOfficialId !== undefined ? { lineOfficialId: dto.lineOfficialId ?? null } : {}),
      ...(dto.facebookUrl !== undefined ? { facebookUrl: dto.facebookUrl ?? null } : {}),
      ...(dto.status !== undefined ? { status: dto.status } : {}),
      ...(dto.source !== undefined ? { source: dto.source ?? null } : {}),
      ...(dto.ownerUserId !== undefined ? { ownerUserId: dto.ownerUserId ?? null } : {}),
      ...(dto.note !== undefined ? { note: dto.note ?? null } : {}),
      updatedBy: actorId,
    });

    return this.findOne(id);
  }

  /**
   * ลบลูกค้า — เป็น soft delete และลบผู้ติดต่อกับบันทึกการติดต่อตามไปด้วย
   *
   * บล็อกไว้ถ้ามีโครงการหรือใบแจ้งปัญหาผูกอยู่ เพราะข้อมูลพวกนั้นเป็นประวัติทางธุรกิจ
   * ที่ต้องอ้างอิงย้อนหลังได้ ลูกค้าที่เลิกใช้บริการแล้วให้เปลี่ยนสถานะเป็น CHURNED แทน
   * ซึ่งเป็นวิธีเดียวกับที่ใช้กับพนักงานที่ลาออก (CLAUDE.md 4.3)
   */
  async remove(id: number, actorId: number): Promise<void> {
    const customer = await this.findOrFail(id);

    const [projectCount, ticketCount] = await Promise.all([
      this.projectModel.count({ where: { customerId: id } }),
      this.ticketModel.count({ where: { customerId: id } }),
    ]);

    if (projectCount > 0 || ticketCount > 0) {
      throw new BadRequestException(
        'ลูกค้ารายนี้มีโครงการ ' +
          projectCount +
          ' รายการ และใบแจ้งปัญหา ' +
          ticketCount +
          ' รายการผูกอยู่ จึงลบไม่ได้ ถ้าเลิกใช้บริการแล้วให้เปลี่ยนสถานะเป็น CHURNED แทน',
      );
    }

    await this.sequelize.transaction(async (transaction) => {
      await this.contactModel.destroy({ where: { customerId: id }, transaction });
      await this.logModel.destroy({ where: { customerId: id }, transaction });
      await customer.update({ deletedBy: actorId }, { transaction });
      await customer.destroy({ transaction });
    });
  }

  // ---- ใช้ร่วมกับ service อื่นในโมดูลนี้ ------------------------------------

  async findOrFail(id: number): Promise<Customer> {
    const customer = await this.customerModel.findByPk(id);

    if (!customer) {
      throw new NotFoundException('ไม่พบข้อมูลลูกค้า');
    }

    return customer;
  }

  /**
   * อัปเดตวันที่ติดต่อล่าสุด — เรียกจาก CommunicationLogsService
   *
   * เขียนทับเฉพาะเมื่อเวลาที่ส่งมาใหม่กว่าค่าเดิม เพราะ BR-02 อนุญาตให้บันทึกย้อนหลัง
   * ถ้าไม่เช็ค การมาบันทึกการคุยเมื่อเดือนที่แล้วจะทำให้ลูกค้าดูเหมือนเพิ่งติดต่อไป
   * แล้วหลุดจากหน้าจอ "ลูกค้าที่ถูกลืม" ทั้งที่ยังไม่ได้ติดต่อจริง
   */
  async touchLastContactedAt(customerId: number, occurredAt: Date): Promise<void> {
    const customer = await this.customerModel.findByPk(customerId);

    if (!customer) {
      return;
    }

    if (customer.lastContactedAt && customer.lastContactedAt >= occurredAt) {
      return;
    }

    customer.lastContactedAt = occurredAt;
    await customer.save();
  }

  // ---- helpers -------------------------------------------------------------

  /**
   * รหัสลูกค้าต้องไม่ซ้ำ — ตรวจรวมรายการที่ถูก soft delete ไปแล้วด้วย (paranoid: false)
   * เพราะ unique index ในฐานข้อมูลไม่สนใจ deleted_at
   */
  private async assertCodeIsAvailable(code: string, excludeId?: number): Promise<void> {
    const where: WhereOptions<Customer> = excludeId
      ? { code, id: { [Op.ne]: excludeId } }
      : { code };

    const existing = await this.customerModel.findOne({ where, paranoid: false });

    if (existing) {
      throw new ConflictException('รหัสลูกค้านี้ถูกใช้ไปแล้ว');
    }
  }

  private async assertOwnerExists(ownerUserId: number): Promise<void> {
    const owner = await this.userModel.findByPk(ownerUserId, { attributes: ['id', 'status'] });

    if (!owner) {
      throw new BadRequestException('ไม่พบพนักงานที่ระบุเป็นผู้ดูแล');
    }

    if (owner.status !== UserStatus.ACTIVE) {
      throw new BadRequestException(
        'พนักงานที่ระบุไม่ได้อยู่ในสถานะใช้งาน จึงมอบหมายให้ดูแลลูกค้าไม่ได้',
      );
    }
  }
}
