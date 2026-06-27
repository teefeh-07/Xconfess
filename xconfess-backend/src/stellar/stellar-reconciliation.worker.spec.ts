import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { StellarReconciliationWorker } from './stellar-reconciliation.worker';
import { StellarAnchor, AnchorStatus } from './entities/stellar-anchor.entity';
import { StellarService } from './stellar.service';
import { ContractService } from './contract.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { ConfigService } from '@nestjs/config';
import { AnonymousConfession } from '../confession/entities/confession.entity';
import { AuditActionType } from '../audit-log/audit-log.entity';

// Mock decryptConfession
jest.mock('../utils/confession-encryption', () => ({
  decryptConfession: jest.fn().mockReturnValue('decrypted'),
}));

describe('StellarReconciliationWorker', () => {
  let worker: StellarReconciliationWorker;
  let anchorRepository: any;
  let confessionRepository: any;
  let stellarService: any;
  let contractService: any;
  let auditService: any;
  let configService: any;

  beforeEach(async () => {
    anchorRepository = {
      find: jest.fn(),
      save: jest.fn(),
    };

    confessionRepository = {
      findOne: jest.fn(),
      save: jest.fn(),
    };

    stellarService = {
      hashConfession: jest.fn().mockReturnValue('mockHash'),
    };

    contractService = {
      anchorConfession: jest.fn(),
    };

    auditService = {
      log: jest.fn(),
    };

    configService = {
      get: jest.fn().mockReturnValue('secret'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StellarReconciliationWorker,
        {
          provide: getRepositoryToken(StellarAnchor),
          useValue: anchorRepository,
        },
        {
          provide: getRepositoryToken(AnonymousConfession),
          useValue: confessionRepository,
        },
        { provide: StellarService, useValue: stellarService },
        { provide: ContractService, useValue: contractService },
        { provide: AuditLogService, useValue: auditService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    worker = module.get<StellarReconciliationWorker>(StellarReconciliationWorker);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('Test 1: Success on second attempt', async () => {
    const oldDate = new Date(Date.now() - 10 * 60 * 1000);
    const anchor = {
      id: 'a1',
      status: AnchorStatus.PENDING,
      retryCount: 1,
      lastRetryAt: new Date(Date.now() - 3 * 60 * 1000), // > 2 min ago (2^1 = 2m)
      createdAt: oldDate,
      confessionId: 'c1',
    } as StellarAnchor;

    anchorRepository.find.mockResolvedValue([anchor]);
    confessionRepository.findOne.mockResolvedValue({ id: 'c1', message: 'enc' } as AnonymousConfession);

    // mock success
    contractService.anchorConfession.mockResolvedValue({ hash: 'txhash123' });

    await worker.reconcilePendingAnchors();

    // expect status = anchored
    expect(anchor.status).toBe(AnchorStatus.ANCHORED);
    // expect retryCount reset
    expect(anchor.retryCount).toBe(0);
    // expect audit log written
    expect(auditService.log).toHaveBeenCalledWith({
      actionType: AuditActionType.STELLAR_ANCHOR_RETRY,
      metadata: { entityId: 'a1', attempt_number: 2 },
    });
    // expect repo saved
    expect(anchorRepository.save).toHaveBeenCalledWith(anchor);
    expect(confessionRepository.save).toHaveBeenCalled();
  });

  it('Test 2: Retry exhaustion', async () => {
    const oldDate = new Date(Date.now() - 10 * 60 * 1000);
    const anchor = {
      id: 'a2',
      status: AnchorStatus.PENDING,
      retryCount: 4,
      lastRetryAt: new Date(Date.now() - 17 * 60 * 1000), // > 16 min ago (2^4 = 16m)
      createdAt: oldDate,
      confessionId: 'c2',
    } as StellarAnchor;

    anchorRepository.find.mockResolvedValue([anchor]);
    confessionRepository.findOne.mockResolvedValue({ id: 'c2', message: 'enc' } as AnonymousConfession);

    contractService.anchorConfession.mockRejectedValue(new Error('Horizon failed'));

    await worker.reconcilePendingAnchors();

    // expect retryCount = 5
    expect(anchor.retryCount).toBe(5);
    // expect status = failed
    expect(anchor.status).toBe(AnchorStatus.FAILED);
    // expect audit entries written for retry AND fail
    expect(auditService.log).toHaveBeenCalledWith({
      actionType: AuditActionType.STELLAR_ANCHOR_RETRY,
      metadata: { entityId: 'a2', attempt_number: 5, error_message: 'Horizon failed' },
    });
    expect(auditService.log).toHaveBeenCalledWith({
      actionType: AuditActionType.STELLAR_ANCHOR_FAILED,
      metadata: { entityId: 'a2' },
    });
  });

  it('Test 3: Only old records processed', async () => {
    // This tests the behavior of find() using LessThan, but here we can mock it 
    // or test the exponential backoff if lastRetryAt is recent
    const recentDate = new Date(Date.now() - 2 * 60 * 1000); // 2 minutes ago
    const anchor = {
      id: 'a3',
      status: AnchorStatus.PENDING,
      retryCount: 1,
      lastRetryAt: recentDate,
      createdAt: new Date(),
      confessionId: 'c3',
    } as StellarAnchor;

    anchorRepository.find.mockResolvedValue([anchor]);

    await worker.reconcilePendingAnchors();

    // The delay for count 1 is 2 mins. If timeSinceLastRetry is < 2 mins, it skips.
    // wait, timeSinceLastRetry is ~2 min. Let's make lastRetryAt 1 minute ago so it clearly skips.
    anchor.lastRetryAt = new Date(Date.now() - 1 * 60 * 1000);
    
    await worker.reconcilePendingAnchors();

    expect(anchor.retryCount).toBe(1); // skipped
    expect(contractService.anchorConfession).not.toHaveBeenCalled();
  });

  it('executes without HTTP request context (no req, no middleware)', async () => {
    const oldDate = new Date(Date.now() - 10 * 60 * 1000);
    const anchor = {
      id: 'a5',
      status: AnchorStatus.PENDING,
      retryCount: 1,
      lastRetryAt: new Date(Date.now() - 3 * 60 * 1000),
      createdAt: oldDate,
      confessionId: 'c5',
    } as StellarAnchor;

    anchorRepository.find.mockResolvedValue([anchor]);
    confessionRepository.findOne.mockResolvedValue({ id: 'c5', message: 'enc' } as AnonymousConfession);
    contractService.anchorConfession.mockResolvedValue({ hash: 'txhash456' });

    await expect(worker.reconcilePendingAnchors()).resolves.not.toThrow();
    expect(anchor.status).toBe(AnchorStatus.ANCHORED);
  });

  it('Test 4: Audit log payload', async () => {
    const anchor = {
      id: 'a4',
      status: AnchorStatus.PENDING,
      retryCount: 2,
      lastRetryAt: new Date(Date.now() - 5 * 60 * 1000), // > 4 min ago (2^2 = 4m)
      createdAt: new Date(),
      confessionId: 'c4',
    } as StellarAnchor;

    anchorRepository.find.mockResolvedValue([anchor]);
    confessionRepository.findOne.mockResolvedValue({ id: 'c4', message: 'enc' } as AnonymousConfession);

    contractService.anchorConfession.mockRejectedValue(new Error('Test Error'));

    await worker.reconcilePendingAnchors();

    expect(auditService.log).toHaveBeenCalledWith({
      actionType: AuditActionType.STELLAR_ANCHOR_RETRY,
      metadata: {
        entityId: 'a4',
        attempt_number: 3,
        error_message: 'Test Error',
      },
    });
  });
});
