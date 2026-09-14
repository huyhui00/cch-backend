import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { Op, type WhereOptions } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';

import { getCurrentUserId } from '../../common/context/request-context';
import { type PaginatedResult, toPaginatedResult } from '../../common/dto/pagination.dto';
import { nextSequenceNumber } from '../../common/utils/code-sequence.util';
import { toDateOnly, todayAsDateOnly } from '../../common/utils/date.util';
import {
  AcceptanceStatus,
  Attachment,
  type AttachmentRefType,
  Contact,
  Delivery,
  Project,
  ProjectStatus,
  User,
  Warranty,
  WarrantyStatus,
} from '../../models';
import { ProjectsService } from '../projects/projects.service';
import { WarrantiesService } from '../warranties/warranties.service';
import {
  CreateDeliveryDto,
  QueryDeliveriesDto,
  UpdateAcceptanceDto,
  UpdateDeliveryDto,
} from './dto/delivery.dto';
import {
  canIssueWarranty,
  type DeliveryResponseDto,
  toDeliveryResponse,
} from './dto/delivery.response';

/**
 * ref_type ของไฟล์แนบที่เป็นของใบส่งมอบ
 *
 * ผูกชนิดไว้กับ AttachmentRefType เพื่อให้พิมพ์ผิดเป็น error ตอน build
 * ไม่ใช่ไปเงียบ ๆ แล้วคืนไฟล์แนบเป็นรายการว่างตลอดกาลโดยไม่มีใครรู้
 */
const ATTACHMENT_REF_TYPE: AttachmentRefType = 'DELIVERY';

/**
 * สถานะโครงการที่การยอมรับการส่งมอบครั้งสุดท้ายจะพาไปเป็น DELIVERED ให้เอง
 * CLOSED / CANCELLED ไม่แตะ เพราะเป็นการตัดสินใจของคนที่เกิดทีหลังแล้ว
 */
const OPEN_PROJECT_STATUSES: readonly ProjectStatus[] = [
  ProjectStatus.DRAFT,
  ProjectStatus.IN_PROGRESS,
];

/**
 * ฟิลด์ที่ยอมให้เรียงลำดับได้
 *
 * ไม่มี `version` ในรายการนี้โดยเจตนา — version เก็บเป็นข้อความอิสระ ("v1.2.0",
 * "รอบที่ 2") การเรียงแบบพจนานุกรมจะได้ v10 มาก่อน v2 ซึ่งผิดจากที่คนคาดหวัง
 * ประวัติการส่งมอบจึงเรียงด้วยเวลาที่ส่งมอบจริงเป็นหลัก ซึ่งให้ลำดับเดียวกับ
 * ลำดับเวอร์ชันอยู่แล้วในทางปฏิบัติ
 */
const SORTABLE_FIELDS = new Set([
  'id',
  'deliveryNo',
  'deliveredAt',
  'acceptanceStatus',
  'createdAt',
]);

/** สร้างใหม่ทุกครั้ง — Sequelize แก้ object ของ include ในที่ตอน normalize ห้ามใช้ร่วมกัน */
function projectInclude() {
  return {
    model: Project,
    attributes: ['id', 'name', 'customerId'],
    required: false,
    // โครงการที่ถูก soft delete แล้วยังต้องเห็นชื่อได้ ไม่งั้นใบส่งมอบเก่าจะไร้ที่มา
    paranoid: false,
  };
}

function acceptedByContactInclude() {
  return {
    model: Contact,
    as: 'acceptedByContact',
    attributes: ['id', 'name'],
    required: false,
    paranoid: false,
  };
}

function deliveredByUserInclude() {
  return {
    model: User,
    as: 'deliveredByUser',
    attributes: ['id', 'username', 'fullName'],
    required: false,
    // ผู้ส่งมอบที่ลาออกไปแล้วยังต้องเห็นชื่อได้ (BR-09)
    paranoid: false,
  };
}

/**
 * Phase 6 — การส่งมอบ (โมดูล M3)
 *
 * ใบส่งมอบเป็นจุดตั้งต้นของระยะประกันตาม BR-06 การแก้ `deliveredAt` จึงมีผลต่อ
 * ประกันที่ออกไปแล้ว ดูรายละเอียดที่ WarrantiesService.resyncByDelivery()
 */
@Injectable()
export class DeliveriesService {
  constructor(
    @InjectModel(Delivery) private readonly deliveryModel: typeof Delivery,
    @InjectModel(Warranty) private readonly warrantyModel: typeof Warranty,
    @InjectModel(Contact) private readonly contactModel: typeof Contact,
    @InjectModel(User) private readonly userModel: typeof User,
    @InjectModel(Attachment) private readonly attachmentModel: typeof Attachment,
    @InjectConnection() private readonly sequelize: Sequelize,
    private readonly projectsService: ProjectsService,
    private readonly warrantiesService: WarrantiesService,
  ) {}

  /**
   * ประวัติการส่งมอบของโครงการ
   *
   * เรียงจากใหม่ไปเก่าเป็นค่าเริ่มต้น เพราะหน้าจอต้องการรู้ว่า "เวอร์ชันล่าสุดคืออะไร"
   * เป็นคำถามแรกเสมอ
   */
  async findAllByProject(
    projectId: number,
    query: QueryDeliveriesDto,
  ): Promise<PaginatedResult<DeliveryResponseDto>> {
    await this.projectsService.findOrFail(projectId);

    const where: WhereOptions<Delivery> = { projectId };

    if (query.acceptanceStatus) {
      Object.assign(where, { acceptanceStatus: query.acceptanceStatus });
    }

    if (query.version) {
      Object.assign(where, { version: query.version });
    }

    if (query.search) {
      const like = '%' + query.search + '%';
      Object.assign(where, {
        [Op.or]: [{ title: { [Op.like]: like } }, { deliveryNo: { [Op.like]: like } }],
      });
    }

    const sortBy = SORTABLE_FIELDS.has(query.sortBy ?? '')
      ? (query.sortBy as string)
      : 'deliveredAt';

    const { rows, count } = await this.deliveryModel.findAndCountAll({
      where,
      include: [projectInclude(), acceptedByContactInclude(), deliveredByUserInclude()],
      distinct: true,
      // ส่งมอบสองรอบในวันเดียวกันได้ ต้องมีตัวตัดสินรองไม่งั้นลำดับสลับไปมาระหว่างหน้า
      order: [
        [sortBy, query.sortOrder],
        ['id', query.sortOrder],
      ],
      limit: query.limit,
      offset: query.offset,
    });

    const onDate = todayAsDateOnly();

    return toPaginatedResult(
      rows.map((delivery) => toDeliveryResponse(delivery, { onDate })),
      count,
      query,
    );
  }

  /** รายละเอียดใบส่งมอบ พร้อมประกันที่ออกจากใบนี้และไฟล์แนบ */
  async findOne(id: number): Promise<DeliveryResponseDto> {
    const delivery = await this.deliveryModel.findByPk(id, {
      include: [projectInclude(), acceptedByContactInclude(), deliveredByUserInclude()],
    });

    if (!delivery) {
      throw new NotFoundException('ไม่พบข้อมูลการส่งมอบ');
    }

    const [warranties, attachments] = await Promise.all([
      this.warrantyModel.findAll({ where: { deliveryId: id }, order: [['id', 'ASC']] }),
      this.attachmentModel.findAll({
        where: { refType: ATTACHMENT_REF_TYPE, refId: id },
        order: [['id', 'ASC']],
      }),
    ]);

    return toDeliveryResponse(delivery, {
      warranties,
      attachments,
      onDate: todayAsDateOnly(),
    });
  }

  async create(projectId: number, dto: CreateDeliveryDto): Promise<DeliveryResponseDto> {
    const actorId = getCurrentUserId();
    const project = await this.projectsService.findOrFail(projectId);

    if (dto.deliveredByUserId) {
      await this.assertUserExists(dto.deliveredByUserId);
    }

    if (dto.acceptedByContactId) {
      await this.assertContactBelongsToCustomer(dto.acceptedByContactId, project.customerId);
    }

    const deliveredAt = new Date(dto.deliveredAt);
    this.assertNotInFuture(deliveredAt);

    const delivery = await this.sequelize.transaction(async (transaction) => {
      const sequence = await nextSequenceNumber(
        this.sequelize,
        `DELIVERY:${projectId}`,
        transaction,
      );

      return this.deliveryModel.create(
        {
          projectId,
          title: dto.title,
          version: dto.version ?? null,
          deliveryNo:
            `DLV-${project.code ?? `PRJ-${new Date().getFullYear()}-${String(projectId).padStart(3, '0')}`}-` +
            String(sequence).padStart(2, '0'),
          description: dto.description ?? null,
          deliveredAt,
          acceptanceStatus: AcceptanceStatus.PENDING,
          acceptedAt: null,
          acceptedByContactId: dto.acceptedByContactId ?? null,
          deliveredByUserId: dto.deliveredByUserId ?? null,
          note: dto.note ?? null,
          createdBy: actorId,
          updatedBy: actorId,
        },
        { transaction },
      );
    });

    return this.findOne(delivery.id);
  }

  async update(id: number, dto: UpdateDeliveryDto): Promise<DeliveryResponseDto> {
    const actorId = getCurrentUserId();
    const delivery = await this.findOrFail(id);

    if (dto.deliveredByUserId) {
      await this.assertUserExists(dto.deliveredByUserId);
    }

    if (dto.acceptedByContactId) {
      const project = await this.projectsService.findOrFail(delivery.projectId);
      await this.assertContactBelongsToCustomer(dto.acceptedByContactId, project.customerId);
    }

    let deliveredAt: Date | undefined;

    if (dto.deliveredAt !== undefined) {
      deliveredAt = new Date(dto.deliveredAt);
      this.assertNotInFuture(deliveredAt);
    }

    // แก้วันส่งมอบแล้วประกันต้องขยับตาม ไม่งั้นจะขัด BR-06 แบบเงียบ ๆ
    // ทำในทรานแซกชันเดียวกัน ถ้าขยับประกันไม่สำเร็จ การแก้วันส่งมอบต้องถูกยกเลิกด้วย
    await this.sequelize.transaction(async (transaction) => {
      await delivery.update(
        {
          ...(dto.title !== undefined ? { title: dto.title } : {}),
          ...(dto.version !== undefined ? { version: dto.version ?? null } : {}),
          ...(dto.description !== undefined ? { description: dto.description ?? null } : {}),
          ...(deliveredAt !== undefined ? { deliveredAt } : {}),
          ...(dto.deliveredByUserId !== undefined
            ? { deliveredByUserId: dto.deliveredByUserId ?? null }
            : {}),
          ...(dto.acceptedByContactId !== undefined
            ? { acceptedByContactId: dto.acceptedByContactId ?? null }
            : {}),
          ...(dto.note !== undefined ? { note: dto.note ?? null } : {}),
          updatedBy: actorId,
        },
        { transaction },
      );

      if (deliveredAt !== undefined) {
        await this.warrantiesService.resyncByDelivery(delivery, transaction);
      }
    });

    return this.findOne(id);
  }

  /**
   * บันทึกผลการตรวจรับ
   *
   * ไม่บังคับลำดับการเปลี่ยนสถานะ ด้วยเหตุผลเดียวกับสถานะงานใน Phase 5 —
   * ของจริงถอยกลับได้ เช่นตรวจรับไปแล้วเพิ่งมาพบว่าใช้งานไม่ได้จริง
   * `acceptedAt` ถูกจัดการให้สอดคล้องกับสถานะเสมอ ไม่ปล่อยให้ค้าง
   *
   * "การส่งมอบครั้งสุดท้าย" (`isFinal`) ยืนยันที่นี่ด้วย (ตกลง 11 ก.ย.) — ใบที่ยอมรับแล้ว
   * และเป็นครั้งสุดท้ายคือใบเดียวที่ออกประกันได้ และเป็นจุดที่โครงการกลายเป็น DELIVERED
   *
   * กติกาที่ตามมา:
   * - ใบที่ออกประกันไปแล้ว ถอยออกจาก "ยอมรับ + ครั้งสุดท้าย" ไม่ได้จนกว่าประกันทุกใบจะถูก VOID
   *   ไม่งั้นจะเหลือประกันที่ยังคุ้มครองอยู่บนงานที่ลูกค้าไม่ได้รับ แล้วการเปิดใบแจ้งปัญหา
   *   จะเสนอ "ในประกัน" ผิด ๆ
   * - 1 โครงการมีครั้งสุดท้ายที่ยอมรับแล้วได้ใบเดียว ไม่งั้นประกันมีวันเริ่มหลายจุด
   * - เข้าสู่ "ยอมรับ + ครั้งสุดท้าย" → โครงการที่ยังเป็น DRAFT / IN_PROGRESS เป็น DELIVERED
   *   ออกจากสถานะนั้น → โครงการที่เป็น DELIVERED กลับเป็น IN_PROGRESS
   *   ทำในทรานแซกชันเดียวกับการตรวจรับ สถานะโครงการจะได้ไม่ค้างผิดเมื่อขั้นใดพัง
   */
  async updateAcceptance(id: number, dto: UpdateAcceptanceDto): Promise<DeliveryResponseDto> {
    const actorId = getCurrentUserId();
    const delivery = await this.findOrFail(id);
    const project = await this.projectsService.findOrFail(delivery.projectId);

    // ไม่ส่ง isFinal มา = คงค่าเดิม ตรวจรับซ้ำโดยไม่ตอบคำถามเรื่องครั้งสุดท้ายต้องไม่ล้างค่า
    const nextIsFinal = dto.isFinal ?? delivery.isFinal;
    const wasFinalAccepted = canIssueWarranty(delivery);
    const willBeFinalAccepted = canIssueWarranty({
      acceptanceStatus: dto.acceptanceStatus,
      isFinal: nextIsFinal,
    });

    if (wasFinalAccepted && !willBeFinalAccepted) {
      await this.assertNoActiveWarranty(id);
    }

    if (willBeFinalAccepted && !wasFinalAccepted) {
      await this.assertNoOtherFinalAccepted(delivery);
    }

    if (dto.acceptedByContactId) {
      await this.assertContactBelongsToCustomer(dto.acceptedByContactId, project.customerId);
    }

    await this.sequelize.transaction(async (transaction) => {
      await delivery.update(
        {
          ...this.acceptancePatch(delivery, dto.acceptanceStatus),
          isFinal: nextIsFinal,
          ...(dto.acceptedByContactId !== undefined
            ? { acceptedByContactId: dto.acceptedByContactId ?? null }
            : {}),
          ...(dto.note !== undefined ? { note: dto.note ?? null } : {}),
          updatedBy: actorId,
        },
        { transaction },
      );

      if (
        willBeFinalAccepted &&
        !wasFinalAccepted &&
        OPEN_PROJECT_STATUSES.includes(project.status)
      ) {
        await project.update(
          {
            status: ProjectStatus.DELIVERED,
            actualEndDate: toDateOnly(delivery.deliveredAt),
            updatedBy: actorId,
          },
          { transaction },
        );
      }

      if (wasFinalAccepted && !willBeFinalAccepted && project.status === ProjectStatus.DELIVERED) {
        await project.update(
          { status: ProjectStatus.IN_PROGRESS, actualEndDate: null, updatedBy: actorId },
          { transaction },
        );
      }
    });

    return this.findOne(id);
  }

  // ---- ใช้ร่วมกับ WarrantiesService ----------------------------------------

  async findOrFail(id: number): Promise<Delivery> {
    const delivery = await this.deliveryModel.findByPk(id);

    if (!delivery) {
      throw new NotFoundException('ไม่พบข้อมูลการส่งมอบ');
    }

    return delivery;
  }

  // ---- helpers -------------------------------------------------------------

  private async assertNoActiveWarranty(deliveryId: number): Promise<void> {
    const activeWarranties = await this.warrantyModel.count({
      where: { deliveryId, status: { [Op.ne]: WarrantyStatus.VOID } },
    });

    if (activeWarranties > 0) {
      throw new ConflictException(
        `การส่งมอบนี้ออกประกันไปแล้ว ${activeWarranties} ใบ ต้องยกเลิกประกัน (VOID) ก่อน ` +
          'จึงเปลี่ยนสถานะการตรวจรับหรือเครื่องหมายครั้งสุดท้ายได้',
      );
    }
  }

  /** 1 โครงการมีการส่งมอบครั้งสุดท้ายที่ยอมรับแล้วได้ใบเดียว — ประกันจะได้มีวันเริ่มจุดเดียว */
  private async assertNoOtherFinalAccepted(delivery: Delivery): Promise<void> {
    const other = await this.deliveryModel.findOne({
      where: {
        projectId: delivery.projectId,
        isFinal: true,
        acceptanceStatus: AcceptanceStatus.ACCEPTED,
        id: { [Op.ne]: delivery.id },
      },
      attributes: ['id', 'title', 'version'],
    });

    if (other) {
      const label = other.version ? `${other.title} (${other.version})` : other.title;
      throw new ConflictException(
        `โครงการนี้มีการส่งมอบครั้งสุดท้ายที่ลูกค้ายอมรับแล้ว คือ "${label}" (ส่งมอบ #${other.id}) ` +
          'ถ้าจะเปลี่ยนเป็นใบนี้ ให้เอาเครื่องหมายครั้งสุดท้ายออกจากใบเดิมก่อน',
      );
    }
  }

  /** ตั้งหรือล้าง acceptedAt ให้สอดคล้องกับสถานะเสมอ */
  private acceptancePatch(
    delivery: Delivery,
    acceptanceStatus: AcceptanceStatus,
  ): { acceptanceStatus: AcceptanceStatus; acceptedAt: Date | null } {
    if (acceptanceStatus === AcceptanceStatus.ACCEPTED) {
      // ตรวจรับซ้ำไม่ทับเวลาเดิม จะได้รู้ว่าลูกค้ารับมอบจริงเมื่อไร
      return { acceptanceStatus, acceptedAt: delivery.acceptedAt ?? new Date() };
    }

    return { acceptanceStatus, acceptedAt: null };
  }

  /**
   * เลขที่ใบส่งมอบต้องไม่ซ้ำ — ตรวจรวมรายการที่ถูก soft delete ไปแล้วด้วย
   * เพราะ unique index ในฐานข้อมูลไม่สนใจ deleted_at
   */
  private async assertDeliveryNoIsAvailable(deliveryNo: string, excludeId?: number): Promise<void> {
    const where: WhereOptions<Delivery> = excludeId
      ? { deliveryNo, id: { [Op.ne]: excludeId } }
      : { deliveryNo };

    const existing = await this.deliveryModel.findOne({ where, paranoid: false });

    if (existing) {
      throw new ConflictException('เลขที่ใบส่งมอบนี้ถูกใช้ไปแล้ว');
    }
  }

  /**
   * ผู้ส่งมอบต้องมีตัวตนในระบบ แต่ไม่บังคับว่าต้อง ACTIVE
   *
   * ต่างจากการมอบหมายงานหรือตั้งผู้จัดการโครงการที่ต้องเป็นคนที่ยังทำงานอยู่
   * เพราะนี่คือการบันทึกว่า "ใครเป็นคนส่งมอบ" ซึ่งเป็นข้อเท็จจริงในอดีต
   * บริษัทเพิ่งเริ่มใช้ระบบและต้องคีย์ของเก่าย้อนหลัง คนที่ส่งมอบไปอาจลาออกแล้ว
   */
  private async assertUserExists(userId: number): Promise<void> {
    const user = await this.userModel.findByPk(userId, {
      attributes: ['id'],
      paranoid: false,
    });

    if (!user) {
      throw new BadRequestException('ไม่พบพนักงานที่ระบุเป็นผู้ส่งมอบ');
    }
  }

  /** กันการระบุผู้รับมอบที่เป็นคนของลูกค้ารายอื่น ซึ่งทำให้ประวัติปนข้ามราย */
  private async assertContactBelongsToCustomer(
    contactId: number,
    customerId: number,
  ): Promise<void> {
    const contact = await this.contactModel.findByPk(contactId, {
      attributes: ['id', 'customerId'],
    });

    if (!contact) {
      throw new BadRequestException('ไม่พบผู้ติดต่อที่ระบุ');
    }

    if (contact.customerId !== customerId) {
      throw new BadRequestException('ผู้ติดต่อที่ระบุไม่ได้อยู่ภายใต้ลูกค้าเจ้าของโครงการนี้');
    }
  }

  /**
   * บันทึกย้อนหลังได้ แต่บันทึกล่วงหน้าไม่ได้ (เผื่อนาฬิกาคลาดเคลื่อน 5 นาที)
   *
   * ที่ต้องกันไว้เพราะวันส่งมอบเป็นจุดตั้งต้นของระยะประกัน (BR-06) ถ้าปล่อยให้
   * ลงวันที่ในอนาคต ประกันจะเริ่มในอนาคตด้วย แล้ว isUnderWarranty จะตอบว่า
   * "ไม่อยู่ในประกัน" สำหรับ ticket ที่เปิดวันนี้ ทั้งที่หน้าจอแสดงว่ามีประกันอยู่
   */
  private assertNotInFuture(deliveredAt: Date): void {
    const CLOCK_SKEW_MS = 5 * 60 * 1000;

    if (deliveredAt.getTime() > Date.now() + CLOCK_SKEW_MS) {
      throw new BadRequestException('วันที่ส่งมอบต้องไม่เป็นเวลาในอนาคต');
    }
  }
}
