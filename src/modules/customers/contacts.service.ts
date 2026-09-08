import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { Op, type Transaction, type WhereOptions } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';

import { type PaginatedResult, toPaginatedResult } from '../../common/dto/pagination.dto';
import { CommunicationLog, Contact } from '../../models';
import { CustomersService } from './customers.service';
import { type ContactResponseDto, toContactResponse } from './dto/customer.response';
import { CreateContactDto, QueryContactsDto, UpdateContactDto } from './dto/contact.dto';

const SORTABLE_FIELDS = new Set(['id', 'name', 'position', 'isPrimary', 'createdAt', 'updatedAt']);

@Injectable()
export class ContactsService {
  constructor(
    @InjectModel(Contact) private readonly contactModel: typeof Contact,
    @InjectModel(CommunicationLog) private readonly logModel: typeof CommunicationLog,
    @InjectConnection() private readonly sequelize: Sequelize,
    private readonly customersService: CustomersService,
  ) {}

  async findAll(query: QueryContactsDto): Promise<PaginatedResult<ContactResponseDto>> {
    const where: WhereOptions<Contact> = {};

    if (query.customerId !== undefined) {
      Object.assign(where, { customerId: query.customerId });
    }

    if (query.isPrimary !== undefined) {
      Object.assign(where, { isPrimary: query.isPrimary });
    }

    if (query.search) {
      const like = '%' + query.search + '%';
      Object.assign(where, {
        [Op.or]: [
          { name: { [Op.like]: like } },
          { nickname: { [Op.like]: like } },
          { position: { [Op.like]: like } },
          { phone: { [Op.like]: like } },
          { email: { [Op.like]: like } },
        ],
      });
    }

    const sortBy = SORTABLE_FIELDS.has(query.sortBy ?? '') ? (query.sortBy as string) : 'name';

    const { rows, count } = await this.contactModel.findAndCountAll({
      where,
      // ผู้ติดต่อหลักขึ้นก่อนเสมอ แล้วค่อยเรียงตามที่ผู้ใช้ขอ
      order: [
        ['isPrimary', 'DESC'],
        [sortBy, query.sortOrder],
      ],
      limit: query.limit,
      offset: query.offset,
    });

    return toPaginatedResult(rows.map(toContactResponse), count, query);
  }

  async create(dto: CreateContactDto, actorId: number): Promise<ContactResponseDto> {
    // โยน 404 ถ้าไม่มีลูกค้ารายนี้ ดีกว่าปล่อยให้ FK พังแล้วได้ข้อความที่อ่านไม่รู้เรื่อง
    await this.customersService.findOrFail(dto.customerId);

    const contactId = await this.sequelize.transaction(async (transaction) => {
      if (dto.isPrimary) {
        await this.demoteOtherPrimaries(dto.customerId, null, actorId, transaction);
      }

      const contact = await this.contactModel.create(
        {
          customerId: dto.customerId,
          name: dto.name,
          nickname: dto.nickname ?? null,
          position: dto.position ?? null,
          phone: dto.phone ?? null,
          email: dto.email ?? null,
          lineId: dto.lineId ?? null,
          isPrimary: dto.isPrimary ?? false,
          note: dto.note ?? null,
          createdBy: actorId,
          updatedBy: actorId,
        },
        { transaction },
      );

      return contact.id;
    });

    return this.findOneOrFail(contactId).then(toContactResponse);
  }

  async update(id: number, dto: UpdateContactDto, actorId: number): Promise<ContactResponseDto> {
    const contact = await this.findOneOrFail(id);

    await this.sequelize.transaction(async (transaction) => {
      if (dto.isPrimary === true && !contact.isPrimary) {
        await this.demoteOtherPrimaries(contact.customerId, id, actorId, transaction);
      }

      await contact.update(
        {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.nickname !== undefined ? { nickname: dto.nickname ?? null } : {}),
          ...(dto.position !== undefined ? { position: dto.position ?? null } : {}),
          ...(dto.phone !== undefined ? { phone: dto.phone ?? null } : {}),
          ...(dto.email !== undefined ? { email: dto.email ?? null } : {}),
          ...(dto.lineId !== undefined ? { lineId: dto.lineId ?? null } : {}),
          ...(dto.isPrimary !== undefined ? { isPrimary: dto.isPrimary } : {}),
          ...(dto.note !== undefined ? { note: dto.note ?? null } : {}),
          updatedBy: actorId,
        },
        { transaction },
      );
    });

    return toContactResponse(await this.findOneOrFail(id));
  }

  /**
   * ลบผู้ติดต่อ — soft delete
   *
   * บล็อกถ้ายังมีบันทึกการติดต่ออ้างอิงอยู่ เพราะบันทึกเหล่านั้นคือหลักฐานว่าคุยกับใคร
   * ถ้าปล่อยให้ลบ ประวัติจะเหลือแต่ชื่อลูกค้าโดยไม่รู้ว่าคุยกับใคร ซึ่งขัดกับเจตนาของ BR-02
   */
  async remove(id: number, actorId: number): Promise<void> {
    const contact = await this.findOneOrFail(id);

    const logCount = await this.logModel.count({ where: { contactId: id } });

    if (logCount > 0) {
      throw new BadRequestException(
        'ผู้ติดต่อรายนี้ถูกอ้างอิงในบันทึกการติดต่อ ' +
          logCount +
          ' รายการ จึงลบไม่ได้ ถ้าไม่ได้ติดต่อกับคนนี้แล้วให้แก้ข้อมูลหรือใส่หมายเหตุแทน',
      );
    }

    await contact.update({ deletedBy: actorId });
    await contact.destroy();
  }

  // ---- helpers -------------------------------------------------------------

  private async findOneOrFail(id: number): Promise<Contact> {
    const contact = await this.contactModel.findByPk(id);

    if (!contact) {
      throw new NotFoundException('ไม่พบข้อมูลผู้ติดต่อ');
    }

    return contact;
  }

  /**
   * ผู้ติดต่อหลักมีได้คนเดียวต่อลูกค้า 1 ราย
   * ตั้งคนใหม่เป็นหลัก = ถอดคนเดิมออกอัตโนมัติ ทำในทรานแซกชันเดียวกับการตั้งคนใหม่
   * จะได้ไม่มีจังหวะที่มีผู้ติดต่อหลักสองคนพร้อมกัน
   */
  private async demoteOtherPrimaries(
    customerId: number,
    exceptContactId: number | null,
    actorId: number,
    transaction: Transaction,
  ): Promise<void> {
    const where: WhereOptions<Contact> = exceptContactId
      ? { customerId, isPrimary: true, id: { [Op.ne]: exceptContactId } }
      : { customerId, isPrimary: true };

    const current = await this.contactModel.findAll({ where, transaction });

    for (const contact of current) {
      // อัปเดตทีละแถวผ่าน instance เพื่อให้ audit hook บันทึกเป็น UPDATE พร้อม record_id
      // ถ้าใช้ update({ where }) จะได้ BULK_UPDATE ที่ไม่รู้ว่าใครถูกถอด (BR-09)
      await contact.update({ isPrimary: false, updatedBy: actorId }, { transaction });
    }
  }
}
