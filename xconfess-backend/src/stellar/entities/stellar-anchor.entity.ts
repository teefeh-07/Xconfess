import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum AnchorStatus {
  PENDING = 'pending',
  ANCHORED = 'anchored',
  FAILED = 'failed',
}

@Entity('stellar_anchors')
export class StellarAnchor {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'confession_id', type: 'uuid' })
  @Index()
  confessionId: string;

  @Column({
    type: 'enum',
    enum: AnchorStatus,
    default: AnchorStatus.PENDING,
  })
  @Index()
  status: AnchorStatus;

  @Column({ name: 'retry_count', type: 'int', default: 0 })
  retryCount: number;

  @Column({ name: 'last_retry_at', type: 'timestamp', nullable: true })
  lastRetryAt: Date;

  @Column({ name: 'stellar_tx_hash', type: 'varchar', nullable: true })
  stellarTxHash: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
