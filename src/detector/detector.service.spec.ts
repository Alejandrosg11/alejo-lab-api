/* eslint-disable @typescript-eslint/unbound-method -- Jest mocked functions do not use a receiver. */
import axios from 'axios';
import { fileTypeFromBuffer } from 'file-type';
import { DetectorService } from './detector.service';

// Keep the ESM-only signature detector outside this provider-contract unit test.
// Real file signatures and multipart integration belong to the e2e suite.
jest.mock('file-type', () => ({ fileTypeFromBuffer: jest.fn() }), {
  virtual: true,
});
jest.mock('axios');
const post = jest.mocked(axios.post);
const detectType = jest.mocked(fileTypeFromBuffer);

describe('DetectorService with simulated Sightengine', () => {
  const originalEnv = { ...process.env };
  const file = {
    buffer: Buffer.from('unit-test-fixture'),
    originalname: 'fixture.png',
    mimetype: 'image/png',
    size: 17,
  } as Express.Multer.File;

  beforeEach(() => {
    jest.resetAllMocks();
    process.env.SIGHTENGINE_USER = 'unit-test-user';
    process.env.SIGHTENGINE_SECRET = 'unit-test-secret';
    detectType.mockResolvedValue({ ext: 'png', mime: 'image/png' });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns the result and operation count from a successful response', async () => {
    post.mockResolvedValueOnce({
      data: {
        status: 'success',
        type: { ai_generated: 0.91 },
        request: { id: 'unit-test-request', operations: 5 },
      },
    });
    const result = await new DetectorService().checkGenAI(file);
    expect(result.result).toMatchObject({ percentage: 91, label: 'alta' });
    expect(result.analysis.operations).toBe(5);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('rejects a response without a detection score', async () => {
    post.mockResolvedValueOnce({ data: { status: 'success' } });
    await expect(new DetectorService().checkGenAI(file)).rejects.toMatchObject({
      status: 503,
    });
  });

  it('reports a simulated timeout', async () => {
    jest.mocked(axios.isAxiosError).mockReturnValue(true);
    post.mockRejectedValueOnce({ code: 'ECONNABORTED' });
    await expect(new DetectorService().checkGenAI(file)).rejects.toMatchObject({
      status: 503,
    });
  });

  it('does not contact Sightengine for an unsupported signature', async () => {
    detectType.mockResolvedValue(undefined);
    await expect(new DetectorService().checkGenAI(file)).rejects.toMatchObject({
      status: 400,
    });
    expect(post).not.toHaveBeenCalled();
  });
});
