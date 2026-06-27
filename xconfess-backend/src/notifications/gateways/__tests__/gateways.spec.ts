import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { Socket } from 'socket.io';
import { NotificationsGateway } from '../notifications.gateway';
import { ReactionsGateway } from '../reactions.gateway';
import {
  WsAuthFailureReason,
  scrubPii,
  classifyAuthError,
  emitWsAuthFailure,
} from '../../../auth/ws-auth-telemetry';

function makeSocket(overrides: Partial<Socket['handshake']> = {}): jest.Mocked<Socket> {
  return {
    id: 'test-client-id',
    handshake: { headers: {}, query: {}, ...overrides },
    emit: jest.fn(),
    disconnect: jest.fn(),
    join: jest.fn(),
  } as unknown as jest.Mocked<Socket>;
}

function makeJwtService(behaviour: 'ok' | 'expired' | 'malformed' | 'invalid_sig') {
  const mock = { verifyAsync: jest.fn() } as unknown as jest.Mocked<JwtService>;
  if (behaviour === 'ok') {
    mock.verifyAsync.mockResolvedValue({ sub: 'user-123' });
  } else {
    const messages: Record<string, string> = {
      expired: 'jwt expired',
      malformed: 'jwt malformed',
      invalid_sig: 'invalid signature',
    };
    mock.verifyAsync.mockRejectedValue(new Error(messages[behaviour]));
  }
  return mock;
}

describe('scrubPii', () => {
  it('removes authorization header', () => {
    const result = scrubPii({ authorization: 'Bearer secret', userId: '123' });
    expect(result).not.toHaveProperty('authorization');
    expect(result).toHaveProperty('userId');
  });

  it('removes cookie, token, jwt, email, wallet', () => {
    const input = { cookie: 'session=abc', token: 'xyz', jwt: 'zzz', email: 'u@e.com', wallet: 'G...', safe: 'keep' };
    expect(Object.keys(scrubPii(input))).toEqual(['safe']);
  });
});

describe('classifyAuthError', () => {
  it('classifies expired', () => expect(classifyAuthError(new Error('jwt expired'))).toBe(WsAuthFailureReason.TOKEN_EXPIRED));
  it('classifies malformed', () => expect(classifyAuthError(new Error('jwt malformed'))).toBe(WsAuthFailureReason.TOKEN_MALFORMED));
  it('classifies invalid signature', () => expect(classifyAuthError(new Error('invalid signature'))).toBe(WsAuthFailureReason.TOKEN_INVALID_SIGNATURE));
  it('classifies unknown', () => expect(classifyAuthError(new Error('network timeout'))).toBe(WsAuthFailureReason.UNKNOWN));
  it('handles null', () => expect(classifyAuthError(null)).toBe(WsAuthFailureReason.UNKNOWN));
});

describe('emitWsAuthFailure', () => {
  it('logs a warning and returns a UUID correlationId', () => {
    const logger = new Logger();
    const warn = jest.spyOn(logger, 'warn').mockImplementation();
    const id = emitWsAuthFailure(logger, 'TestGateway', WsAuthFailureReason.TOKEN_MISSING);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(warn.mock.calls[0][0]).not.toMatch(/bearer|cookie|jwt|email|wallet/i);
  });
});

describe('NotificationsGateway', () => {
  let gateway: NotificationsGateway;

  async function build(behaviour: Parameters<typeof makeJwtService>[0]) {
    const module: TestingModule = await Test.createTestingModule({
      providers: [NotificationsGateway, { provide: JwtService, useValue: makeJwtService(behaviour) }],
    }).compile();
    gateway = module.get(NotificationsGateway);
  }

  it('emits TOKEN_MISSING and disconnects when no token', async () => {
    await build('ok');
    const client = makeSocket();
    await gateway.handleConnection(client);
    expect(client.emit).toHaveBeenCalledWith('auth_error', expect.objectContaining({ reason: WsAuthFailureReason.TOKEN_MISSING }));
    expect(client.disconnect).toHaveBeenCalledWith(true);
  });

  it('auth_error includes a correlationId UUID', async () => {
    await build('ok');
    const client = makeSocket();
    await gateway.handleConnection(client);
    const [, payload] = (client.emit as jest.Mock).mock.calls[0];
    expect(payload.correlationId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('emits TOKEN_EXPIRED for expired token', async () => {
    await build('expired');
    const client = makeSocket({ headers: { authorization: 'Bearer x' } });
    await gateway.handleConnection(client);
    expect(client.emit).toHaveBeenCalledWith('auth_error', expect.objectContaining({ reason: WsAuthFailureReason.TOKEN_EXPIRED }));
  });

  it('emits TOKEN_MALFORMED for malformed token', async () => {
    await build('malformed');
    const client = makeSocket({ headers: { authorization: 'Bearer x' } });
    await gateway.handleConnection(client);
    expect(client.emit).toHaveBeenCalledWith('auth_error', expect.objectContaining({ reason: WsAuthFailureReason.TOKEN_MALFORMED }));
  });

  it('allows valid connection', async () => {
    await build('ok');
    const client = makeSocket({ headers: { authorization: 'Bearer valid' } });
    await gateway.handleConnection(client);
    expect(client.disconnect).not.toHaveBeenCalled();
  });
});

describe('ReactionsGateway', () => {
  let gateway: ReactionsGateway;

  async function build(behaviour: Parameters<typeof makeJwtService>[0]) {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ReactionsGateway, { provide: JwtService, useValue: makeJwtService(behaviour) }],
    }).compile();
    gateway = module.get(ReactionsGateway);
  }

  it('emits TOKEN_MISSING when no auth header', async () => {
    await build('ok');
    const client = makeSocket();
    await gateway.handleConnection(client);
    expect(client.emit).toHaveBeenCalledWith('auth_error', expect.objectContaining({ reason: WsAuthFailureReason.TOKEN_MISSING }));
  });

  it('emits TOKEN_EXPIRED for expired token', async () => {
    await build('expired');
    const client = makeSocket({ headers: { authorization: 'Bearer x' } });
    await gateway.handleConnection(client);
    expect(client.emit).toHaveBeenCalledWith('auth_error', expect.objectContaining({ reason: WsAuthFailureReason.TOKEN_EXPIRED }));
  });

  it('emits TOKEN_INVALID_SIGNATURE', async () => {
    await build('invalid_sig');
    const client = makeSocket({ headers: { authorization: 'Bearer x' } });
    await gateway.handleConnection(client);
    expect(client.emit).toHaveBeenCalledWith('auth_error', expect.objectContaining({ reason: WsAuthFailureReason.TOKEN_INVALID_SIGNATURE }));
  });

  it('allows valid connection', async () => {
    await build('ok');
    const client = makeSocket({ headers: { authorization: 'Bearer valid' } });
    await gateway.handleConnection(client);
    expect(client.disconnect).not.toHaveBeenCalled();
  });
});
