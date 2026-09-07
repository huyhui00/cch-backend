import {
  AutoIncrement,
  Column,
  CreatedAt,
  DataType,
  DeletedAt,
  Model,
  PrimaryKey,
  UpdatedAt,
} from 'sequelize-typescript';

/**
 * ฟิลด์มาตรฐานของทุกตารางหลัก (CLAUDE.md 6.3)
 *
 *   created_at, created_by, updated_at, updated_by, deleted_at, deleted_by
 *
 * soft delete ผ่าน paranoid: true — ห้ามลบข้อมูลจริง เพราะ audit log
 * ต้องอ้างอิงย้อนหลังได้ (BR-09)
 *
 * หมายเหตุ: created_by / updated_by / deleted_by เก็บเป็น BIGINT UNSIGNED เฉย ๆ
 * ไม่ผูก FK ไปที่ users เพราะจะกลายเป็น 90 constraints ทั่วทั้ง 30 ตาราง
 * และ users ถูก soft delete เท่านั้นจึงไม่เกิดแถวกำพร้าในทางปฏิบัติ
 */
export abstract class AuditedModel<
  TAttributes extends object = object,
  TCreation extends object = TAttributes,
> extends Model<TAttributes, TCreation> {
  @PrimaryKey
  @AutoIncrement
  @Column({ type: DataType.BIGINT.UNSIGNED })
  id: number;

  @CreatedAt
  @Column({ type: DataType.DATE, field: 'created_at' })
  createdAt: Date;

  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: true, field: 'created_by' })
  createdBy: number | null;

  @UpdatedAt
  @Column({ type: DataType.DATE, field: 'updated_at' })
  updatedAt: Date;

  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: true, field: 'updated_by' })
  updatedBy: number | null;

  @DeletedAt
  @Column({ type: DataType.DATE, allowNull: true, field: 'deleted_at' })
  deletedAt: Date | null;

  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: true, field: 'deleted_by' })
  deletedBy: number | null;
}
