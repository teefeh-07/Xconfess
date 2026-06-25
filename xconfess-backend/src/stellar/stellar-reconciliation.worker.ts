import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { StellarAnchor, AnchorStatus } from './entities/stellar-anchor.entity';
import { StellarService } from './stellar.service';
import { ContractService } from './contract.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditActionType } from '../audit-log/audit-log.entity';
import { AnonymousConfession } from '../confession/entities/confession.entity';
import { decryptConfession } from '../utils/confession-encryption';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class StellarReconciliationWorker {
  private readonly logger = new Logger(StellarReconciliationWorker.name);

  constructor(
    @InjectRepository(StellarAnchor)
    private readonly anchorRepository: Repository<StellarAnchor>,
    @InjectRepository(AnonymousConfession)
    private readonly confessionRepository: Repository<AnonymousConfession>,
    private readonly stellarService: StellarService,
    private readonly contractService: ContractService,
    private readonly auditService: AuditLogService,
    private readonly configService: ConfigService,
  ) {}

  @Cron(process.env.STELLAR_RECONCILIATION_INTERVAL || CronExpression.EVERY_MINUTE)
  async reconcilePendingAnchors() {
    const FIVE_MINUTES = 5 * 60 * 1000;
    const anchors = await this.anchorRepository.find({
      where: {
        status: AnchorStatus.PENDING,
        createdAt: LessThan(new Date(Date.now() - FIVE_MINUTES)),
      },
    });

    if (anchors.length > 0) {
      this.logger.log(`Found ${anchors.length} pending anchors to reconcile`);
    }

    for (const anchor of anchors) {
      await this.retryAnchor(anchor);
    }
  }

  private async retryAnchor(anchor: StellarAnchor) {
    const delay = Math.pow(2, anchor.retryCount) * 60 * 1000; // delay in ms
    const timeSinceLastRetry = Date.now() - (anchor.lastRetryAt?.getTime() || anchor.createdAt.getTime());

    // Respect exponential backoff
    if (timeSinceLastRetry < delay) {
      return;
    }

    anchor.retryCount += 1;
    anchor.lastRetryAt = new Date();

    try {
      this.logger.warn({
        event: 'stellar_anchor_retry',
        anchorId: anchor.id,
        attemptNumber: anchor.retryCount,
      });

      await this.auditService.log({
        actionType: AuditActionType.STELLAR_ANCHOR_RETRY,
        metadata: {
          entityId: anchor.id,
          attempt_number: anchor.retryCount,
        },
      });

      const confession = await this.confessionRepository.findOne({ where: { id: anchor.confessionId } });
      if (!confession) {
        throw new Error('Confession not found');
      }

      const aesKey = this.configService.get<string>('app.confessionAesKey', '');
      const decryptedMessage = decryptConfession(confession.message, aesKey);
      
      const timestamp = Date.now();
      const hash = this.stellarService.hashConfession(decryptedMessage, timestamp);

      const serverSecret = this.configService.get<string>('STELLAR_SERVER_SECRET');
      if (!serverSecret) {
        throw new Error('Server secret key not configured');
      }

      const txResult = await this.contractService.anchorConfession(hash, timestamp, serverSecret);

      anchor.status = AnchorStatus.ANCHORED;
      anchor.stellarTxHash = txResult.hash;
      anchor.retryCount = 0;
      await this.anchorRepository.save(anchor);
      
      confession.isAnchored = true;
      confession.stellarTxHash = txResult.hash;
      confession.stellarHash = hash;
      confession.anchoredAt = new Date();
      await this.confessionRepository.save(confession);

      this.logger.log(`Successfully anchored confession ${anchor.confessionId}`);
    } catch (error: any) {
      this.logger.warn({
        event: 'stellar_anchor_retry',
        anchorId: anchor.id,
        attemptNumber: anchor.retryCount,
        error: error.message,
      });

      await this.auditService.log({
        actionType: AuditActionType.STELLAR_ANCHOR_RETRY,
        metadata: {
          entityId: anchor.id,
          attempt_number: anchor.retryCount,
          error_message: error.message,
        },
      });

      if (anchor.retryCount >= 5) {
        anchor.status = AnchorStatus.FAILED;
        
        this.logger.error({
          event: 'stellar_anchor_failed',
          anchorId: anchor.id,
          attempts: anchor.retryCount,
        });

        await this.auditService.log({
          actionType: AuditActionType.STELLAR_ANCHOR_FAILED,
          metadata: {
            entityId: anchor.id,
          },
        });
      }

      await this.anchorRepository.save(anchor);
    }
  }
}
