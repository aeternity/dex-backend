import { Test, TestingModule } from '@nestjs/testing';

import { HttpService } from '@/clients/http.service';
import { SuperheroClientService } from '@/clients/superhero-client.service';
import resetAllMocks = jest.resetAllMocks;
import { RateLimiter } from 'limiter';

import {
  aeUsdPriceMock,
  superheroResponsePriceData,
} from '@/test/mock-data/pair-liquidity-info-history-mock-data';

const mockHttpService = {
  get: jest.fn(),
};

describe('SuperheroClientService', () => {
  let service: SuperheroClientService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SuperheroClientService,
        { provide: HttpService, useValue: mockHttpService },
      ],
    }).compile();
    service = module.get<SuperheroClientService>(SuperheroClientService);
    resetAllMocks();
  });

  describe('getHistoricalPriceDataThrottled', () => {
    it('should call Superhero API with correct days/interval for the given timestamp and return closest usd price', async () => {
      // 2024-01-02 (> 365 days ago) → days=max, interval=daily
      mockHttpService.get.mockResolvedValue(superheroResponsePriceData);

      const result =
        await service.getHistoricalPriceDataThrottled(1704203614123);

      expect(mockHttpService.get).toHaveBeenCalledWith(
        'https://api.superhero.com/api/coins/aeternity/history?currency=usd&days=max&interval=daily',
      );
      expect(result).toBe(aeUsdPriceMock);
    });

    it('should be throtteled to defined rate limit', async () => {
      service['rateLimiter'] = new RateLimiter({
        tokensPerInterval: 2,
        interval: 'minute',
      });

      // Mock
      mockHttpService.get.mockResolvedValue(superheroResponsePriceData);
      await service.getHistoricalPriceDataThrottled(1704203935123);
      await service.getHistoricalPriceDataThrottled(1704203935123);
      service.getHistoricalPriceDataThrottled(1704203935123);

      await new Promise((res) => setTimeout(res, 200));

      // Assertion
      expect(mockHttpService.get).toHaveBeenCalledTimes(2);
    });
  });
});
