import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Req,
  Res,
  UsePipes,
  ValidationPipe,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiBody,
  ApiResponse,
  ApiHeader,
} from '@nestjs/swagger';
import { TippingService } from './tipping.service';
import { VerifyTipDto } from './dto/verify-tip.dto';

@ApiTags('Tipping')
@Controller('confessions/:id/tips')
export class TippingController {
  constructor(private readonly tippingService: TippingService) {}

  @Get()
  @ApiOperation({ summary: 'List all tips for a confession' })
  @ApiParam({ name: 'id', description: 'Confession UUID' })
  @ApiResponse({
    status: 200,
    description: 'Tips for the confession.',
    schema: {
      example: [
        {
          id: 'tip-abc-123',
          confessionId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
          amount: 100,
          txHash: 'a3f8e2d1b4c5a6e7f8d9c0b1a2e3f4d5c6b7a8e9f0d1c2b3a4e5f6d7c8b9a0e1',
          status: 'completed',
          createdAt: '2026-04-25T10:00:00.000Z',
        },
      ],
    },
  })
  getTips(@Param('id') confessionId: string) {
    return this.tippingService.getTipsByConfessionId(confessionId);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get aggregate tip stats for a confession' })
  @ApiParam({ name: 'id', description: 'Confession UUID' })
  @ApiResponse({
    status: 200,
    description: 'Tip statistics.',
    schema: {
      example: {
        totalAmount: 550,
        tipCount: 3,
        latestTip: '2026-04-25T10:00:00.000Z',
      },
    },
  })
  getTipStats(@Param('id') confessionId: string) {
    return this.tippingService.getTipStats(confessionId);
  }

  /**
   * Verify and record a Stellar XLM tip transaction.
   *
   * Issue #170: Returns distinct HTTP status codes for replay safety:
   *   201 — new tip verified and recorded for the first time.
   *   200 — idempotent replay; the same confessionId+txHash was already
   *         verified. The canonical tip record is returned without
   *         double-crediting. An `X-Idempotent-Replay: true` header is set.
   *   409 — the txHash was already used for a different confession or is
   *         currently being processed.
   */
  @Post('verify')
  @Throttle({ strict: {} })
  @UsePipes(new ValidationPipe({ whitelist: true }))
  @ApiOperation({
    summary: 'Verify and record a Stellar XLM tip transaction',
    description:
      'Idempotent endpoint — submitting the same confessionId + txId ' +
      'pair more than once returns the original tip without double-crediting. ' +
      'New tips return 201; replay-safe duplicates return 200 with an ' +
      '`X-Idempotent-Replay: true` response header. Rate limited per ' +
      'IP+confession to protect against RPC cost spikes.',
  })
  @ApiParam({ name: 'id', description: 'Confession UUID' })
  @ApiBody({
    type: VerifyTipDto,
    description: 'Stellar transaction ID to verify.',
  })
  @ApiResponse({
    status: 201,
    description: 'Tip verified and recorded (first submission).',
  })
  @ApiResponse({
    status: 200,
    description:
      'Idempotent replay — tip was already verified for this confession. ' +
      'Response includes `X-Idempotent-Replay: true` header.',
  })
  @ApiHeader({
    name: 'X-Idempotent-Replay',
    description: 'Set to "true" when the response is a replay of a previously verified tip.',
    required: false,
  })
  @ApiResponse({ status: 400, description: 'Invalid transaction ID or transaction not found on-chain.' })
  @ApiResponse({ status: 409, description: 'Transaction already used for a different confession or currently processing.' })
  @ApiResponse({ status: 429, description: 'Too many verification requests for this confession. Retry after the window in the `Retry-After-strict` header.' })
  async verifyTip(
    @Param('id') confessionId: string,
    @Body() dto: VerifyTipDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const requestId = (req as any).requestId as string | undefined;
    const result = await this.tippingService.verifyAndRecordTip(
      confessionId,
      dto,
      requestId,
    );

    if (result.isIdempotent) {
      // Issue #170: Replay-safe response — return 200, not 201
      res.status(HttpStatus.OK);
      res.setHeader('X-Idempotent-Replay', 'true');
    } else {
      res.status(result.isNew ? HttpStatus.CREATED : HttpStatus.OK);
    }

    return {
      success: true,
      tipId: result.tip.id,
      confessionId: result.tip.confessionId,
      amount: result.tip.amount,
      txId: result.tip.txId,
      verificationStatus: result.tip.verificationStatus,
      verifiedAt: result.tip.verifiedAt,
      isNew: result.isNew,
      isIdempotent: result.isIdempotent,
      requestId: requestId ?? null,
    };
  }
}